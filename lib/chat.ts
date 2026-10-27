/**
 * Asks OpenAI for a chat completion. When the model requests get_account, this
 * file runs that tool through the dispatcher and sends the result back so the
 * model can write the final sentence. The caller may pass earlier user and
 * assistant turns; those are checked and capped. The system prompt is added
 * here and is never taken from the caller. When the provider response includes
 * usage, those token counts are returned so the route can record them. The key
 * is read from OPENAI_API_KEY and is never returned. This file does not
 * register list_charges, decide a refund, store the thread, or write a pending row.
 */

import { dispatchTool, type ToolResult } from "./tools";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Chat model that supports completions. Override with OPENAI_MODEL. */
export const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You are Northline Copilot, helping a support operator. Answer in one or two plain sentences. A short follow-up refers to the earlier turns in this conversation, so answer from that thread. When the operator asks you to look up an account, call get_account with that account id, then summarize the tool result: customer name, plan, and account id. Do not invent account facts. get_account is the only tool. You cannot queue a refund or search policy.";

/** The only tool this chat loop may run. list_charges stays off the loop. */
const GET_ACCOUNT_TOOL = {
  type: "function",
  function: {
    name: "get_account",
    description:
      "Look up one Northline account by id. Use this when the operator asks to look up an account such as acct-monthly-late. Returns that account. Does not queue a refund or search policy.",
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
} as const;

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
  | { ok: true; reply: string; usage: TokenUsage | null; toolCalls: ChatToolCall[] }
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
    tools: [GET_ACCOUNT_TOOL],
    tool_choice: "auto",
  });
  if (!first.ok) return first;

  const requested = readToolCalls(first.payload);
  if (requested.length === 0) {
    const reply = redact(readReply(first.payload) ?? "", apiKey).trim();
    if (!reply) {
      return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
    }
    return { ok: true, reply, usage: readUsage(first.payload), toolCalls: [] };
  }

  const toolCalls: ChatToolCall[] = [];
  const echoed: EchoedToolCall[] = [];
  const toolMessages: ProviderMessage[] = [];
  const usedCallIds = new Set<string>();

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
    if (name !== "get_account") {
      content = JSON.stringify({ ok: false, error: "That tool is not available." });
    } else if (!parsed.ok) {
      content = JSON.stringify({ ok: false, error: parsed.error });
    } else {
      content = await runGetAccount(runTool, parsed.value, apiKey);
    }

    toolMessages.push({ role: "tool", tool_call_id: id, content });
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

  return {
    ok: true,
    reply,
    usage: addUsage(readUsage(first.payload), readUsage(followUp.payload)),
    toolCalls,
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

async function runGetAccount(
  runTool: ChatToolRunner,
  args: unknown,
  apiKey: string,
): Promise<string> {
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat passed to lib/:", { name: "get_account", arguments: args });
  }

  let result: ToolResult;
  try {
    result = await runTool("get_account", args);
  } catch {
    result = { ok: false, tool: "get_account", error: "Could not run get_account." };
  }

  const content = redact(JSON.stringify(result), apiKey).slice(0, 8000);
  if (process.env.NODE_ENV === "development") {
    console.log("POST /api/chat tool result from lib/:", content);
  }
  return content;
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
