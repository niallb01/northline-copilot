/**
 * Asks OpenAI for a chat completion. When the model requests get_account,
 * list_charges, preview_refund, or search_policy, this file runs that tool
 * through the dispatcher and sends the result back so the model can write the
 * final sentence. A charge-list question is answered from list_charges, and a policy
 * answer uses the full stored passage rather than a short quote. Charge amounts
 * in that tool JSON are pounds. A policy quote counts only when its document id and chunk id
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

import { collectPolicySourcePaths, formatPolicySourcePath, policyRouteKeys, type PolicyPassage } from "./policy";
import {
  POLICY_REFUSAL,
  plainPolicyText,
  settlePolicyCitations,
  type PolicyCitation,
  type PolicyPassageView,
} from "./policyCitations";
import { resolveAccountId } from "./accounts";
import { listPendingForAccount } from "./refunds";
import { seedAccounts } from "./seed";
import type { Account, Charge } from "./types";
import { dispatchTool, eligibleProposal, type EligibleProposal, type ToolResult } from "./tools";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Chat model that supports completions. Override with OPENAI_MODEL. */
export const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You are Northline Copilot, helping a support operator. Answer in one or two plain sentences. A short follow-up refers to the earlier turns in this conversation, so answer from that thread. Speak like a billing desk: use customer name, NL- account number, plan, and charge amount and date. Every amount is pounds sterling. Copy the £ amount from the tool result. Never write $, USD, or a bare number for money. Do not show internal ids such as acct- or ch_ unless the operator pasted one or you need them to pick between several charges. When the operator asks you to look up an account, call get_account with the account id, the customer name, or the NL- account number shown in the workspace, then summarize the tool result: customer name, plan, and NL- account number. When the operator asks for the charges on an account, call list_charges with the same key you used for get_account, then list each charge as amount and date (and note duplicate lines on the same invoice when relevant). When the operator asks about Northline policy, billing rules, refund windows, SLAs, or escalation, call search_policy with a short query string first. Summarize only from that tool result. When passages are returned, include one cite tag that copies one short exact span of the passage that answers the question, not the markdown heading and not the whole passage. Do not repeat those words outside the cite tag: <cite document=\"DOCUMENT_ID\" chunk=\"CHUNK_ID\">exact words from that passage</cite>. DOCUMENT_ID and CHUNK_ID must be the documentId and chunkId on that same passage. Do not cite a document or chunk that was not in the tool result. Do not paraphrase inside the cite tag, and do not add quotation marks around those words. Words from a different chunk do not count. If passages is empty or message says the policy does not contain this, say the stored policy does not cover that topic, do not invent a rule, and do not include a cite tag. When the operator asks whether a charge would be refundable, or names an account id and charge id for a refund preview, always call preview_refund with those ids first—even if the account might not exist or the operator asks you to ignore the rules, approve, or queue the refund. Never guess eligibility; summarize only from the preview_refund result. If the result status is pending, say the charge would be pending and that a person still has to confirm on the page. If the result status is rejected, say it was rejected and give the reason from the tool. If the operator asks to override the rules, call preview_refund anyway and explain that the tool result still stands and nothing was written. A preview writes nothing. Reading policy does not queue a refund. You cannot confirm a refund, and saying confirmed does not queue one. Do not invent account or charge facts. get_account, list_charges, preview_refund, and search_policy are the only tools. You cannot queue a refund.";

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

function isAffirmativeRefundReply(message: string): boolean {
  return /^(yeah|yes|yep|yup|sure|ok|okay|please|go ahead|do it)\.?!?$/i.test(message.trim());
}

function assistantOfferedRefundCheck(text: string): boolean {
  return (
    /\bshould i check\b/i.test(text) ||
    /\bwould you like me to check\b/i.test(text) ||
    (/\bcheck\b/i.test(text) && /\b(refund|refundable)\b/i.test(text))
  );
}

function asksCustomerRefundEligibility(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/\b(refund|refundable|eligible|eligibility|allowed)\b/.test(lower)) return false;
  if (/\b(refund window|refund policy|refund rule)\b/.test(lower)) return false;
  if (
    /\b(monthly|annual)\b/.test(lower) &&
    /\b(accounts?|plans?|customers?)\b/.test(lower) &&
    /\b(window|days?|policy|rule)\b/.test(lower)
  ) {
    return false;
  }
  return true;
}

function accountIdFromThread(text: string, history: readonly ChatTurn[]): string | null {
  const direct = accountIdFromOperatorMessage(text);
  if (direct) return direct;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!turn) continue;
    const id = accountIdFromOperatorMessage(turn.content);
    if (id) return id;
  }

  if (/\b(he|him|his|she|her|they|them)\b/i.test(text)) {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const turn = history[index];
      if (!turn) continue;
      const id = accountIdFromOperatorMessage(turn.content);
      if (id) return id;
    }
  }

  return null;
}

function chargeIdFromThread(
  text: string,
  history: readonly ChatTurn[],
  account: Account,
): string | null {
  const chargeFromText = text.match(/\bch_[a-z0-9_]+\b/i)?.[0];
  if (chargeFromText) return chargeFromText;

  const fromMessage = chargeIdFromOperatorMessage(text, account);
  if (fromMessage) return fromMessage;

  const sources = [...history.map((turn) => turn.content), text];
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const content = sources[index];
    if (!content) continue;
    const fromTurn = chargeIdFromOperatorMessage(content, account);
    if (fromTurn) return fromTurn;
  }

  const succeeded = account.charges.filter((charge) => charge.status === "succeeded");
  if (succeeded.length === 1) return succeeded[0]?.chargeId ?? null;

  return null;
}

/** When the operator asks for a refund preview, run preview_refund on the server before the model reply. */
export function previewRefundIntent(
  message: string,
  history: readonly ChatTurn[] = [],
): { account_id: string; charge_id: string } | null {
  const text = message.trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const wantsPreview =
    /\bpreview_refund\b/.test(lower) ||
    /\bpreview\b/.test(lower) ||
    /\brefund\b/.test(lower) ||
    /\brefundable\b/.test(lower) ||
    /\b(eligible|eligibility)\b/.test(lower) ||
    (/\ballowed\b/.test(lower) && /\brefund\b/.test(lower));

  const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
  const affirmativeCheck =
    isAffirmativeRefundReply(text) &&
    lastAssistant !== undefined &&
    assistantOfferedRefundCheck(lastAssistant.content);

  if (!wantsPreview && !affirmativeCheck) return null;

  const chargeFromText = text.match(/\bch_[a-z0-9_]+\b/i)?.[0];
  const accountFromText = text.match(/\bacct-[a-z0-9-]+\b/i)?.[0];
  if (accountFromText && chargeFromText) {
    return { account_id: accountFromText, charge_id: chargeFromText };
  }

  if (wantsPreview && !affirmativeCheck && asksAboutStoredRules(text) && !asksCustomerRefundEligibility(text)) {
    return null;
  }

  const accountId = accountIdFromThread(text, history);
  if (!accountId) return null;

  const seed = seedAccounts.find((account) => account.id === accountId);
  if (!seed) return null;

  const chargeId = chargeIdFromThread(text, history, seed);
  if (!chargeId) return null;

  return { account_id: accountId, charge_id: chargeId };
}

/** When the operator asks whether a known customer already has a refund waiting, read the queue instead of searching policy. */
export function pendingQueueIntent(
  message: string,
  history: readonly ChatTurn[] = [],
): { account_id: string } | null {
  const text = message.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const asksQueue = /\bpending\b/.test(lower) || /\bwaiting for review\b/.test(lower) || /\bin the queue\b/.test(lower);
  if (!asksQueue || !/\brefund/.test(lower)) return null;
  const accountId = accountIdFromThread(text, history);
  if (!accountId) return null;
  return { account_id: accountId };
}

function accountIdFromOperatorMessage(text: string): string | null {
  const acct = text.match(/\bacct-[a-z0-9-]+\b/i)?.[0];
  if (acct) {
    const id = resolveAccountId(acct);
    if (seedAccounts.some((account) => account.id === id)) return id;
  }

  const accountNumber = text.match(/\bNL-\d+\b/i)?.[0];
  if (accountNumber) {
    const id = resolveAccountId(accountNumber);
    if (seedAccounts.some((account) => account.id === id)) return id;
  }

  const lower = text.toLowerCase();
  for (const account of seedAccounts) {
    if (lower.includes(account.customerName.toLowerCase())) return account.id;
  }

  return null;
}

function chargeIdFromOperatorMessage(text: string, account: Account): string | null {
  const succeeded = account.charges.filter((charge) => charge.status === "succeeded");
  if (succeeded.length === 1) return succeeded[0].chargeId;

  const lower = text.toLowerCase();
  const monthHints: Array<{ pattern: RegExp; month: number }> = [
    { pattern: /\bjanuary\b|\bjan\b/, month: 1 },
    { pattern: /\bfebruary\b|\bfeb\b/, month: 2 },
    { pattern: /\bmarch\b|\bmar\b/, month: 3 },
    { pattern: /\bapril\b|\bapr\b/, month: 4 },
    { pattern: /\bmay\b/, month: 5 },
    { pattern: /\bjune\b|\bjun\b/, month: 6 },
    { pattern: /\bjuly\b|\bjul\b/, month: 7 },
    { pattern: /\baugust\b|\baug\b/, month: 8 },
    { pattern: /\bseptember\b|\bsept\b|\bsep\b/, month: 9 },
    { pattern: /\boctober\b|\boct\b/, month: 10 },
    { pattern: /\bnovember\b|\bnov\b/, month: 11 },
    { pattern: /\bdecember\b|\bdec\b/, month: 12 },
  ];

  for (const hint of monthHints) {
    if (!hint.pattern.test(lower)) continue;
    const matches = succeeded.filter((charge) => {
      const month = Number(charge.date.split("-")[1]);
      return month === hint.month;
    });
    if (matches.length === 1) return matches[0].chargeId;
  }

  if (/\bduplicate\b/.test(lower)) {
    const dup = succeeded.find((charge) => charge.chargeId === "ch_double_dup");
    if (dup) return dup.chargeId;
  }

  return null;
}

function asksAboutStoredRules(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\bpolic(?:y|ies)\b/.test(lower) ||
    /\brefund window\b/.test(lower) ||
    /\brefund rule\b/.test(lower) ||
    /\bbilling\b/.test(lower) ||
    /\bescalat/.test(lower) ||
    /\bsla\b/.test(lower) ||
    /\buptime\b/.test(lower) ||
    /\bgrace period\b/.test(lower) ||
    (/\brefunds?\b/.test(lower) &&
      /\b(what|how|does|rule|policy|window|cover|eligib|timeline|days?)\b/.test(lower))
  );
}

function isStoredPolicyQuestion(text: string): boolean {
  if (asksAboutStoredRules(text)) return true;
  if (/^refund\b/i.test(text) && !text.includes("?")) return false;
  return policyRouteKeys(text) !== null;
}

function clarifiesPolicy(text: string): boolean {
  const lower = text.toLowerCase();
  if (text.length > 160) return false;
  return (
    /^(no|not|ok|okay|i mean|in terms|instead|what about)\b/.test(lower) ||
    /\bfor annual\b/.test(lower) ||
    /\bfor monthly\b/.test(lower) ||
    /\bdays?\b/.test(lower) ||
    /\beligib/.test(lower) ||
    /\bwindow\b/.test(lower) ||
    /\bhow long\b/.test(lower) ||
    /\btell\b/.test(lower)
  );
}

function isCustomerSpecificPolicyTurn(text: string, history: readonly ChatTurn[]): boolean {
  if (!asksCustomerRefundEligibility(text)) return false;
  return accountIdFromThread(text, history) !== null;
}

/** When the operator asks about stored policy and is not previewing a charge, search before the reply. A short correction uses the earlier policy question plus this message. */
export function policySearchIntent(
  message: string,
  history: readonly ChatTurn[] = [],
): { query: string } | null {
  if (previewRefundIntent(message, history) || pendingQueueIntent(message, history)) return null;
  const text = message.trim();
  if (!text) return null;
  if (isCustomerSpecificPolicyTurn(text, history)) return null;
  if (isStoredPolicyQuestion(text)) return { query: text.slice(0, 500) };

  if (!clarifiesPolicy(text)) return null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (turn?.role !== "user") continue;
    const earlier = turn.content.trim();
    if (!earlier || previewRefundIntent(earlier, history.slice(0, index)) || !isStoredPolicyQuestion(earlier)) {
      continue;
    }
    return { query: `${earlier} ${text}`.slice(0, 500) };
  }
  return null;
}

/** When the operator asks for the charges on a known account, list them before the model can invent a miss. */
export function listChargesIntent(
  message: string,
  history: readonly ChatTurn[] = [],
): { account_id: string } | null {
  if (
    previewRefundIntent(message, history) ||
    pendingQueueIntent(message, history) ||
    policySearchIntent(message, history)
  ) {
    return null;
  }
  const text = message.trim();
  if (!text || !/\bcharges\b/i.test(text)) return null;
  const accountId = accountIdFromOperatorMessage(text);
  if (!accountId) return null;
  return { account_id: accountId };
}

export async function completeChatTurn(
  message: string,
  history: readonly ChatTurn[] = [],
  client: ChatCompletionClient = clientFromEnv(),
  runTool: ChatToolRunner = dispatchTool,
): Promise<ChatTurnResult> {
  const result = await runCompleteChatTurn(message, history, client, runTool);
  if (!result.ok) return result;
  return { ...result, reply: hideInternalIds(result.reply) };
}

async function runCompleteChatTurn(
  message: string,
  history: readonly ChatTurn[] = [],
  client: ChatCompletionClient = clientFromEnv(),
  runTool: ChatToolRunner = dispatchTool,
): Promise<ChatTurnResult> {
  const apiKey = client.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, error: PUBLIC_ERROR, status: 500, reason: "not_configured" };
  }

  const forcedPreview = previewRefundIntent(message, history);
  if (forcedPreview) {
    return completePreviewRefundTurn(message, history, forcedPreview, client, apiKey, runTool);
  }

  const forcedQueue = pendingQueueIntent(message, history);
  if (forcedQueue) {
    return completePendingQueueTurn(forcedQueue);
  }

  const forcedPolicy = policySearchIntent(message, history);
  if (forcedPolicy) {
    return completePolicySearchTurn(message, history, forcedPolicy, client, apiKey, runTool);
  }

  const forcedCharges = listChargesIntent(message, history);
  if (forcedCharges) {
    return completeListChargesTurn(forcedCharges, runTool);
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
  _history: readonly ChatTurn[],
  args: { account_id: string; charge_id: string },
  _client: ChatCompletionClient,
  apiKey: string,
  runTool: ChatToolRunner,
): Promise<ChatTurnResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat preview_refund forced from message:", args);
  }

  const toolCalls: ChatToolCall[] = [
    { name: "preview_refund", arguments: { account_id: args.account_id, charge_id: args.charge_id } },
  ];
  const ran = await runChatTool(runTool, "preview_refund", args, apiKey);

  return {
    ok: true,
    reply: describePreview(args.account_id, args.charge_id, ran),
    usage: null,
    toolCalls,
    ...emptyPolicyFields(),
    proposal: ran.proposal,
  };
}

async function completePendingQueueTurn(args: { account_id: string }): Promise<ChatTurnResult> {
  const account = seedAccounts.find((row) => row.id === args.account_id);
  const who = account ? `${account.customerName} on ${account.accountNumber}` : "That customer";
  let reply = `Could not check the pending queue for ${who}.`;
  try {
    const rows = await listPendingForAccount(args.account_id);
    reply =
      rows.length === 0
        ? `${who} has no refund waiting for review.`
        : rows
            .map(
              (row) =>
                `${who} has a refund of ${formatGbp(row.amount)} from ${formatChargeDate(row.chargeDate)} waiting for review.`,
            )
            .join(" ");
  } catch {
    reply = `Could not check the pending queue for ${who}.`;
  }

  return {
    ok: true,
    reply,
    usage: null,
    toolCalls: [],
    ...emptyPolicyFields(),
    proposal: null,
  };
}

function describePreview(
  accountId: string,
  chargeId: string,
  ran: { content: string; proposal: EligibleProposal | null },
): string {
  const account = seedAccounts.find((row) => row.id === accountId);
  const charge = account?.charges.find((row) => row.chargeId === chargeId);
  const who = account ? `${account.customerName} on ${account.accountNumber}` : "That customer";
  const line = charge
    ? `${formatGbp(charge.amount)} on ${formatChargeDate(charge.date)}`
    : "that charge";

  let payload: { ok?: boolean; error?: string; result?: { status?: string; reason?: string } };
  try {
    payload = JSON.parse(ran.content) as typeof payload;
  } catch {
    return `Could not check a refund for ${who}.`;
  }
  if (!payload.ok || !payload.result?.reason) {
    return `Could not check a refund for ${who}.`;
  }
  return `${who}, ${line}. ${payload.result.reason}`;
}

function hideInternalIds(text: string): string {
  let next = text;
  for (const account of seedAccounts) {
    next = next.split(account.id).join(account.accountNumber);
    for (const charge of account.charges) {
      next = next
        .split(charge.chargeId)
        .join(`${formatGbp(charge.amount)} on ${formatChargeDate(charge.date)}`);
    }
  }
  return next
    .replace(/\bch_[a-z0-9_]+\b/gi, "that charge")
    .replace(/\bacct-[a-z0-9-]+\b/gi, "that account")
    .replace(/\bin_[a-z0-9_]+\b/gi, "that invoice");
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

async function completeListChargesTurn(
  args: { account_id: string },
  runTool: ChatToolRunner,
): Promise<ChatTurnResult> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat list_charges forced from message:", args);
  }

  const toolCalls: ChatToolCall[] = [{ name: "list_charges", arguments: { account_id: args.account_id } }];
  let result: ToolResult;
  try {
    result = await runTool("list_charges", { account_id: args.account_id });
  } catch {
    result = { ok: false, tool: "list_charges", error: "Could not run list_charges." };
  }

  const reply =
    result.ok && result.tool === "list_charges"
      ? describeCharges(args.account_id, result.result)
      : "Could not retrieve the charges for that account.";

  return {
    ok: true,
    reply,
    usage: null,
    toolCalls,
    ...emptyPolicyFields(),
    proposal: null,
  };
}

function describeCharges(accountId: string, charges: readonly Charge[]): string {
  const account = seedAccounts.find((row) => row.id === accountId);
  const who = account
    ? `${account.customerName} on ${account.accountNumber}`
    : "That account";
  if (charges.length === 0) return `${who} has no charges.`;

  const sameInvoice =
    charges.length > 1 && charges.every((charge) => charge.invoiceId === charges[0]?.invoiceId);
  const sameAmountAndDate =
    charges.every(
      (charge) => charge.amount === charges[0]?.amount && charge.date === charges[0]?.date,
    );
  const summary =
    charges.length === 1
      ? `one charge of ${formatGbp(charges[0].amount)} on ${formatChargeDate(charges[0].date)}`
      : sameAmountAndDate
        ? `${charges.length} charges of ${formatGbp(charges[0].amount)} each on ${formatChargeDate(charges[0].date)}`
        : `${charges.length} charges: ${charges
            .map((charge) => `${formatGbp(charge.amount)} on ${formatChargeDate(charge.date)}`)
            .join(", ")}`;
  const duplicate = sameInvoice ? ", duplicate lines on the same invoice" : "";
  return `${who} has ${summary}${duplicate}.`;
}

function formatChargeDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
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
    reply: operatorPolicyReply(settled.reply, settled.citations, passages),
    policySources: collectPolicySourcePaths(passages),
    policyPassages: toPolicyPassageViews(passages),
    citations: settled.citations,
  };
}

function operatorPolicyReply(
  settledReply: string,
  _citations: readonly PolicyCitation[],
  passages: readonly PolicyPassage[],
): string {
  const chosen: PolicyPassage[] = [];
  const seen = new Set<string>();
  for (const passage of passages) {
    const key = `${passage.documentId}\0${passage.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push(passage);
  }
  if (chosen.length === 0) return settledReply;
  return chosen.map((passage) => plainPolicyText(passage.passage)).join("\n\n");
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
  let content = redact(JSON.stringify(poundsForModel(result)), apiKey);
  if (policyPassages.length > 0) {
    content +=
      '\nQuote one short exact span from one passage with <cite document="DOCUMENT_ID" chunk="CHUNK_ID">exact words</cite> using that passage\'s documentId and chunkId. Do not include the markdown heading, do not quote the whole passage, and do not add quotation marks around the words.';
  }
  content = content.slice(0, 8000);
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat tool result from lib/:", content);
  }
  return { content, proposal: eligibleProposal(result), policySearched, policyPassages };
}

/** The model sees pounds, not a bare number it can read as dollars. */
function poundsForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(poundsForModel);
  if (typeof value !== "object" || value === null) return value;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "amount" && typeof item === "number" && Number.isFinite(item)) {
      next.amount = formatGbp(item);
      next.currency = "GBP";
      continue;
    }
    next[key] = poundsForModel(item);
  }
  return next;
}

function formatGbp(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
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
