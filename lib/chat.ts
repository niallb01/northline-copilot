/**
 * Asks OpenAI for a chat completion. When the model requests get_account,
 * list_charges, preview_refund, or search_policy, this file runs that tool
 * through the dispatcher and sends the result back so the model can write the
 * final sentence. A policy quote counts only when its document id and chunk id
 * were in that turn's search_policy result and the quote is inside that passage.
 * When that search returns no passage, the reply is a refusal and no quote is
 * kept. An eligible preview is returned separately as a proposal for the route
 * to store on the HttpOnly session. That proposal is not part of the tool
 * result. The caller may pass earlier user and assistant turns; those are
 * checked and capped. The system prompt is added here and is never taken from
 * the caller. When the provider response includes usage, those token counts
 * are returned so the route can record them. The key is read from
 * OPENAI_API_KEY and is never returned. This file does not store the thread,
 * insert a pending row, or offer request_refund as a tool.
 */

import { collectPolicySourcePaths, formatPolicySourcePath, type PolicyPassage } from "./policy";
import {
  POLICY_REFUSAL,
  settlePolicyCitations,
  type PolicyCitation,
  type PolicyPassageView,
} from "./policyCitations";
import { dispatchTool, eligibleProposal, type EligibleProposal, type ToolResult } from "./tools";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Chat model that supports completions. Override with OPENAI_MODEL. */
export const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You are Northline Copilot, helping a support operator. Answer in one or two plain sentences. A short follow-up refers to the earlier turns in this conversation, so answer from that thread. When the operator asks you to look up an account, call get_account with that account id, then summarize the tool result: customer name, plan, and account id. When the operator asks for the charges on an account, call list_charges with that account id, then name every charge id from that result. When the operator asks about Northline policy, billing rules, refund windows, SLAs, or escalation, call search_policy with a short query string first. Summarize only from that tool result. When passages are returned, include one cite tag that copies an exact contiguous span of the passage that answers the question: <cite document=\"DOCUMENT_ID\" chunk=\"CHUNK_ID\">exact words from that passage</cite>. DOCUMENT_ID and CHUNK_ID must be the documentId and chunkId on that same passage. Do not cite a document or chunk that was not in the tool result. Do not paraphrase inside the cite tag, and do not add quotation marks around those words. Words from a different chunk do not count. If passages is empty or message says the policy does not contain this, say the stored policy does not cover that topic, do not invent a rule, and do not include a cite tag. When the operator asks whether a charge would be refundable, or names an account id and charge id for a refund preview, always call preview_refund with those ids first—even if the account might not exist or the operator asks you to ignore the rules, approve, or queue the refund. Never guess eligibility; summarize only from the preview_refund result. If the result status is pending, say the charge would be pending and that a person still has to confirm on the page. If the result status is rejected, say it was rejected and give the reason from the tool. If the operator asks to override the rules, call preview_refund anyway and explain that the tool result still stands and nothing was written. A preview writes nothing. Reading policy does not queue a refund. You cannot confirm a refund, and saying confirmed does not queue one. Do not invent account or charge facts. get_account, list_charges, preview_refund, and search_policy are the only tools. You cannot queue a refund.";

/** Tools this chat loop may run. None of them insert a pending row. */
const CHAT_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_account",
      description:
        "Look up one Northline account by id. Use this when the operator asks who the customer is or which plan they are on, for example acct-monthly-late. Returns that account. Does not queue a refund or search policy.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          account_id: {
            type: "string",
            description: "Account id, for example acct-monthly-late.",
          },
        },
        required: ["account_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_charges",
      description:
        "List the charge lines for one Northline account. Use this when the operator asks for charges or charge ids on an account such as acct-double. Returns those charges, including each charge id. Does not queue a refund or search policy.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          account_id: {
            type: "string",
            description: "Account id, for example acct-double.",
          },
        },
        required: ["account_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "preview_refund",
      description:
        "Check whether one charge would be eligible to queue for human review. Use this when the operator asks if a refund would be allowed for an account id and a charge id. Returns pending or rejected and the reason. Writes nothing.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          account_id: {
            type: "string",
            description: "Account id, for example acct-annual-ok.",
          },
          charge_id: {
            type: "string",
            description: "Charge id, for example ch_annual_1.",
          },
        },
        required: ["account_id", "charge_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_policy",
      description:
        "Search stored Northline policy passages by meaning. Use when the operator asks about refund windows, billing, plans, SLA, or escalation. Returns passages with document id and chunk id, or a message when nothing relevant is stored. Does not queue a refund.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Short policy question, for example annual refund window or crypto refund.",
          },
        },
        required: ["query"],
      },
    },
  },
] as const;

const CHAT_TOOL_NAMES = new Set<string>(CHAT_TOOLS.map((tool) => tool.function.name));

/** Tool calls executed in one turn, before the model writes the final sentence. */
const MAX_TOOL_CALLS = 3;

/** Characters accepted in a tool-call arguments string. */
const MAX_TOOL_ARGUMENTS = 2000;

export type ChatToolCall = {
  name: string;
  arguments: unknown;
};

export type ChatToolRunner = (name: string, args: unknown) => Promise<ToolResult>;

/** Newest prior turns forwarded to the model. Older turns are dropped. */
export const MAX_HISTORY_TURNS = 20;

/** Characters allowed in the new message and in each prior turn. */
export const MAX_MESSAGE_LENGTH = 2000;

const PUBLIC_ERROR = "Could not get a model reply.";

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export function readChatRequest(
  body: unknown,
): { message: string; history: ChatTurn[] } | { error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { error: "Request body must be a JSON object." };
  }

  const row = body as Record<string, unknown>;
  if (typeof row.message !== "string") {
    return { error: "A message is required." };
  }

  const message = row.message.trim();
  if (!message) return { error: "A message is required." };
  if (message.length > MAX_MESSAGE_LENGTH) return { error: "That message is too long." };

  if (row.history === undefined) return { message, history: [] };
  if (!Array.isArray(row.history)) {
    return { error: "History must be an array of user and assistant turns." };
  }

  const history: ChatTurn[] = [];
  for (const turn of row.history.slice(-MAX_HISTORY_TURNS)) {
    const parsed = readTurn(turn);
    if ("error" in parsed) return parsed;
    history.push(parsed);
  }

  return { message, history };
}

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ChatTurnResult =
  | {
      ok: true;
      reply: string;
      usage: TokenUsage | null;
      toolCalls: ChatToolCall[];
      /** Paths from search_policy passages; for logs, not the reply text. */
      policySources: string[];
      /** Passages from this turn's search_policy result, for the citations panel. */
      policyPassages: PolicyPassageView[];
      /** Quotes that named a passage in that result and sit inside it. */
      citations: PolicyCitation[];
      proposal: EligibleProposal | null;
    }
  | {
      ok: false;
      error: string;
      status: 500 | 502;
      reason: "not_configured" | "upstream";
    };

export type ChatCompletionClient = {
  apiKey: string | undefined;
  model: string;
  fetch: typeof fetch;
};

/** When the operator names both ids and asks for a refund preview, run the tool on the server. */
export function previewRefundIntent(
  message: string,
): { account_id: string; charge_id: string } | null {
  const text = message.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const wantsPreview =
    /\bpreview_refund\b/.test(lower) ||
    /\bpreview\b/.test(lower) ||
    /\brefund\b/.test(lower) ||
    /\brefundable\b/.test(lower) ||
    (/\ballowed\b/.test(lower) && /\brefund\b/.test(lower));

  if (!wantsPreview) return null;

  const account = text.match(/\bacct-[a-z0-9-]+\b/i)?.[0];
  const charge = text.match(/\bch_[a-z0-9_]+\b/i)?.[0];
  if (!account || !charge) return null;

  return { account_id: account, charge_id: charge };
}

/** When the operator asks about stored policy and is not previewing a charge, search before the reply. */
export function policySearchIntent(message: string): { query: string } | null {
  if (previewRefundIntent(message)) return null;
  const text = message.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const asksAboutStoredRules =
    /\bpolic(?:y|ies)\b/.test(lower) ||
    /\brefund window\b/.test(lower) ||
    /\brefund rule\b/.test(lower) ||
    /\bbilling\b/.test(lower) ||
    /\bescalat/.test(lower) ||
    /\bsla\b/.test(lower) ||
    /\buptime\b/.test(lower) ||
    /\bgrace period\b/.test(lower) ||
    (/\brefunds?\b/.test(lower) &&
      /\b(what|how|does|rule|policy|window|cover)\b/.test(lower));
  if (!asksAboutStoredRules) return null;

  return { query: text.slice(0, 500) };
}

export async function completeChatTurn(
  message: string,
  history: readonly ChatTurn[] = [],
  client: ChatCompletionClient = clientFromEnv(),
  runTool: ChatToolRunner = dispatchTool,
): Promise<ChatTurnResult> {
  const apiKey = client.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, error: PUBLIC_ERROR, status: 500, reason: "not_configured" };
  }

  const forcedPreview = previewRefundIntent(message);
  if (forcedPreview) {
    return completePreviewRefundTurn(message, history, forcedPreview, client, apiKey, runTool);
  }

  const forcedPolicy = policySearchIntent(message);
  if (forcedPolicy) {
    return completePolicySearchTurn(message, history, forcedPolicy, client, apiKey, runTool);
  }

  const messages: ProviderMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: message },
  ];

  const first = await requestCompletion(client, apiKey, {
    messages,
    tools: CHAT_TOOLS,
    tool_choice: "auto",
  });
  if (!first.ok) return first;

  const requested = readToolCalls(first.payload);
  if (requested.length === 0) {
    const reply = redact(readReply(first.payload) ?? "", apiKey).trim();
    if (!reply) {
      return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
    }
    const checked = checkedPolicyReply(reply, []);
    return {
      ok: true,
      reply: checked.reply,
      usage: readUsage(first.payload),
      toolCalls: [],
      policySources: [],
      policyPassages: [],
      citations: checked.citations,
      proposal: null,
    };
  }

  const toolCalls: ChatToolCall[] = [];
  const echoed: EchoedToolCall[] = [];
  const toolMessages: ProviderMessage[] = [];
  const usedCallIds = new Set<string>();
  let proposal: EligibleProposal | null = null;
  const policyPassages: PolicyPassage[] = [];
  let policySearched = false;

  for (const [index, call] of requested.entries()) {
    const id = safeCallId(call.id, index, usedCallIds);
    const name = safeToolName(call.name);
    const parsed = parseToolArguments(call.arguments);
    toolCalls.push({ name, arguments: parsed.shown });
    echoed.push({
      id,
      type: "function",
      function: { name, arguments: call.arguments.slice(0, MAX_TOOL_ARGUMENTS) },
    });

    let content: string;
    if (!CHAT_TOOL_NAMES.has(name)) {
      content = JSON.stringify({ ok: false, error: "That tool is not available." });
    } else if (!parsed.ok) {
      content = JSON.stringify({ ok: false, error: parsed.error });
    } else {
      const ran = await runChatTool(runTool, name, parsed.value, apiKey);
      content = ran.content;
      if (ran.proposal) proposal = ran.proposal;
      if (ran.policySearched) policySearched = true;
      if (ran.policyPassages.length > 0) {
        policyPassages.push(...ran.policyPassages);
      }
    }

    toolMessages.push({ role: "tool", tool_call_id: id, content });
  }

  if (
    policySearched &&
    policyPassages.length === 0 &&
    toolCalls.every((call) => call.name === "search_policy")
  ) {
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat policy citation check:", {
        accepted: [],
        rejected: [],
        refusal: POLICY_REFUSAL,
      });
    }
    return {
      ok: true,
      reply: POLICY_REFUSAL,
      usage: readUsage(first.payload),
      toolCalls,
      ...emptyPolicyFields(),
      proposal,
    };
  }

  const followUp = await requestCompletion(client, apiKey, {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: readAssistantText(first.payload),
        tool_calls: echoed,
      },
      ...toolMessages,
    ],
  });
  if (!followUp.ok) return followUp;

  const reply = redact(readReply(followUp.payload) ?? "", apiKey).trim();
  if (!reply) {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  const checked = checkedPolicyReply(reply, policyPassages);
  return {
    ok: true,
    reply: checked.reply,
    usage: addUsage(readUsage(first.payload), readUsage(followUp.payload)),
    toolCalls,
    policySources: checked.policySources,
    policyPassages: checked.policyPassages,
    citations: checked.citations,
    proposal,
  };
}

async function completePreviewRefundTurn(
  message: string,
  history: readonly ChatTurn[],
  args: { account_id: string; charge_id: string },
  client: ChatCompletionClient,
  apiKey: string,
  runTool: ChatToolRunner,
): Promise<ChatTurnResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat preview_refund forced from message:", args);
  }

  const messages: ProviderMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: message },
  ];

  const toolCalls: ChatToolCall[] = [
    { name: "preview_refund", arguments: { account_id: args.account_id, charge_id: args.charge_id } },
  ];
  const callId = "call_preview";
  const argumentsJson = JSON.stringify(args);
  const ran = await runChatTool(runTool, "preview_refund", args, apiKey);

  const followUp = await requestCompletion(client, apiKey, {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name: "preview_refund", arguments: argumentsJson },
          },
        ],
      },
      { role: "tool", tool_call_id: callId, content: ran.content },
    ],
  });
  if (!followUp.ok) return followUp;

  const reply = redact(readReply(followUp.payload) ?? "", apiKey).trim();
  if (!reply) {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  const checked = checkedPolicyReply(reply, []);
  return {
    ok: true,
    reply: checked.reply,
    usage: readUsage(followUp.payload),
    toolCalls,
    ...emptyPolicyFields(),
    citations: checked.citations,
    proposal: ran.proposal,
  };
}

async function completePolicySearchTurn(
  message: string,
  history: readonly ChatTurn[],
  args: { query: string },
  client: ChatCompletionClient,
  apiKey: string,
  runTool: ChatToolRunner,
): Promise<ChatTurnResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat search_policy forced from message:", args);
  }

  const messages: ProviderMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user", content: message },
  ];

  const toolCalls: ChatToolCall[] = [{ name: "search_policy", arguments: { query: args.query } }];
  const callId = "call_policy";
  const argumentsJson = JSON.stringify(args);
  const ran = await runChatTool(runTool, "search_policy", args, apiKey);

  if (ran.policySearched && ran.policyPassages.length === 0) {
    if (process.env.NODE_ENV === "development") {
      console.log("POST /api/chat policy citation check:", {
        accepted: [],
        rejected: [],
        refusal: POLICY_REFUSAL,
      });
    }
    return {
      ok: true,
      reply: POLICY_REFUSAL,
      usage: null,
      toolCalls,
      ...emptyPolicyFields(),
      proposal: null,
    };
  }

  const followUp = await requestCompletion(client, apiKey, {
    messages: [
      ...messages,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name: "search_policy", arguments: argumentsJson },
          },
        ],
      },
      { role: "tool", tool_call_id: callId, content: ran.content },
    ],
  });
  if (!followUp.ok) return followUp;

  const reply = redact(readReply(followUp.payload) ?? "", apiKey).trim();
  if (!reply) {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  const checked = checkedPolicyReply(reply, ran.policyPassages);
  return {
    ok: true,
    reply: checked.reply,
    usage: readUsage(followUp.payload),
    toolCalls,
    policySources: checked.policySources,
    policyPassages: checked.policyPassages,
    citations: checked.citations,
    proposal: null,
  };
}

type ProviderMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls: EchoedToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type EchoedToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type CompletionBody = {
  messages: ProviderMessage[];
  tools?: readonly unknown[];
  tool_choice?: "auto";
};

async function requestCompletion(
  client: ChatCompletionClient,
  apiKey: string,
  completion: CompletionBody,
): Promise<{ ok: true; payload: unknown } | Extract<ChatTurnResult, { ok: false }>> {
  let response: Response;
  try {
    response = await client.fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: client.model,
        messages: completion.messages,
        max_completion_tokens: 300,
        ...(completion.tools ? { tools: completion.tools, tool_choice: completion.tool_choice } : {}),
      }),
    });
  } catch {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  if (!response.ok) {
    if (process.env.NODE_ENV === "development") {
      console.log("OpenAI chat completion failed:", {
        status: response.status,
        error: redact(readProviderError(payload), apiKey),
      });
    }
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  return { ok: true, payload };
}

type ParsedToolCall = {
  id: string;
  name: string;
  arguments: string;
};

function readToolCalls(payload: unknown): ParsedToolCall[] {
  const message = readAssistantMessage(payload);
  if (!message) return [];
  const calls = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(calls)) return [];

  const parsed: ParsedToolCall[] = [];
  for (const call of calls) {
    if (typeof call !== "object" || call === null) continue;
    const row = call as { id?: unknown; function?: unknown };
    const id = typeof row.id === "string" ? row.id : "";
    const fn = row.function;
    if (typeof fn !== "object" || fn === null) continue;
    const name = (fn as { name?: unknown }).name;
    const args = (fn as { arguments?: unknown }).arguments;
    if (typeof name !== "string" || !name.trim()) continue;
    const argumentsText = argumentsToText(args);
    if (argumentsText === null) continue;
    parsed.push({ id, name, arguments: argumentsText });
    if (parsed.length >= MAX_TOOL_CALLS) break;
  }
  return parsed;
}

function argumentsToText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }
  return null;
}

function parseToolArguments(
  raw: string,
): { ok: true; value: unknown; shown: unknown } | { ok: false; error: string; shown: unknown } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Tool arguments must be JSON.", shown: raw };
  if (text.length > MAX_TOOL_ARGUMENTS) {
    return { ok: false, error: "Tool arguments are too long.", shown: text.slice(0, 200) };
  }
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value, shown: value };
  } catch {
    return { ok: false, error: "Tool arguments must be JSON.", shown: text };
  }
}

function emptyPolicyFields(): {
  policySources: string[];
  policyPassages: PolicyPassageView[];
  citations: PolicyCitation[];
} {
  return { policySources: [], policyPassages: [], citations: [] };
}

function checkedPolicyReply(
  rawReply: string,
  passages: readonly PolicyPassage[],
): {
  reply: string;
  policySources: string[];
  policyPassages: PolicyPassageView[];
  citations: PolicyCitation[];
} {
  const settled = settlePolicyCitations(rawReply, passages);
  if (
    process.env.NODE_ENV === "development" &&
    (passages.length > 0 || settled.citations.length > 0 || settled.rejected.length > 0)
  ) {
    console.log("POST /api/chat policy citation check:", {
      accepted: settled.citations,
      rejected: settled.rejected,
    });
  }
  return {
    reply: settled.reply,
    policySources: collectPolicySourcePaths(passages),
    policyPassages: toPolicyPassageViews(passages),
    citations: settled.citations,
  };
}

function toPolicyPassageViews(passages: readonly PolicyPassage[]): PolicyPassageView[] {
  const seen = new Set<string>();
  const views: PolicyPassageView[] = [];
  for (const passage of passages) {
    const key = `${passage.documentId}\0${passage.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    views.push({
      documentId: passage.documentId,
      chunkId: passage.chunkId,
      path: formatPolicySourcePath(passage.documentId, passage.chunkId),
      text: passage.passage,
    });
  }
  return views;
}

async function runChatTool(
  runTool: ChatToolRunner,
  name: string,
  args: unknown,
  apiKey: string,
): Promise<{
  content: string;
  proposal: EligibleProposal | null;
  policySearched: boolean;
  policyPassages: PolicyPassage[];
}> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat passed to lib/:", { name, arguments: args });
  }

  let result: ToolResult;
  try {
    result = await runTool(name, args);
  } catch {
    result = { ok: false, tool: name, error: `Could not run ${name}.` };
  }

  let policySearched = false;
  let policyPassages: PolicyPassage[] = [];
  if (result.ok && result.tool === "search_policy") {
    policySearched = true;
    policyPassages = result.result.passages;
  }
  let content = redact(JSON.stringify(result), apiKey);
  if (policyPassages.length > 0) {
    content +=
      '\nQuote one exact contiguous span from one passage with <cite document="DOCUMENT_ID" chunk="CHUNK_ID">exact words</cite> using that passage\'s documentId and chunkId. Do not add quotation marks around the words.';
  }
  content = content.slice(0, 8000);
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat tool result from lib/:", content);
  }
  return { content, proposal: eligibleProposal(result), policySearched, policyPassages };
}

function safeCallId(id: string, index: number, used: Set<string>): string {
  const trimmed = id.trim();
  let next = /^[A-Za-z0-9_-]{1,80}$/.test(trimmed) ? trimmed : `call_${index}`;
  while (used.has(next)) next = `call_${index}_${used.size}`;
  used.add(next);
  return next;
}

function safeToolName(name: string): string {
  const trimmed = name.trim();
  return /^[a-z_][a-z0-9_]{0,40}$/.test(trimmed) ? trimmed : "unknown";
}

function readAssistantText(payload: unknown): string | null {
  const message = readAssistantMessage(payload);
  if (!message) return null;
  return readContent((message as { content?: unknown }).content);
}

function readAssistantMessage(payload: unknown): object | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  return message;
}

function addUsage(left: TokenUsage | null, right: TokenUsage | null): TokenUsage | null {
  if (!left) return right;
  if (!right) return left;
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    completionTokens: left.completionTokens + right.completionTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function readTurn(turn: unknown): ChatTurn | { error: string } {
  if (typeof turn !== "object" || turn === null || Array.isArray(turn)) {
    return { error: "Each history turn must be an object." };
  }

  const row = turn as Record<string, unknown>;
  if (row.role !== "user" && row.role !== "assistant") {
    return { error: "History turns must be user or assistant." };
  }
  if (typeof row.content !== "string") {
    return { error: "Each history turn needs text." };
  }

  const content = row.content.trim();
  if (!content) return { error: "Each history turn needs text." };
  if (content.length > MAX_MESSAGE_LENGTH) return { error: "A history turn is too long." };

  return { role: row.role, content };
}

function clientFromEnv(): ChatCompletionClient {
  const model = process.env.OPENAI_MODEL?.trim();
  return {
    apiKey: process.env.OPENAI_API_KEY,
    model: model || DEFAULT_CHAT_MODEL,
    fetch: globalThis.fetch,
  };
}

function readReply(payload: unknown): string | null {
  const message = readAssistantMessage(payload);
  if (!message) return null;

  const row = message as { content?: unknown; refusal?: unknown };
  const content = readContent(row.content);
  if (content) return content;
  if (typeof row.refusal === "string" && row.refusal.trim()) return row.refusal.trim();
  return null;
}

function readContent(content: unknown): string | null {
  if (typeof content === "string") {
    const text = content.trim();
    return text || null;
  }
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (typeof part !== "object" || part === null) continue;
    const text = (part as { text?: unknown }).text;
    if (typeof text === "string") parts.push(text);
  }

  const joined = parts.join("").trim();
  return joined || null;
}

function readUsage(payload: unknown): TokenUsage | null {
  if (typeof payload !== "object" || payload === null) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== "object" || usage === null) return null;

  const row = usage as Record<string, unknown>;
  const promptTokens = readCount(row.prompt_tokens);
  const completionTokens = readCount(row.completion_tokens);
  const totalTokens = readCount(row.total_tokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null) return null;

  return { promptTokens, completionTokens, totalTokens };
}

function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function readProviderError(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.slice(0, 300) : "";
}

function redact(text: string, apiKey: string): string {
  const withoutKey = apiKey ? text.split(apiKey).join("[redacted]") : text;
  return withoutKey.replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]");
}
