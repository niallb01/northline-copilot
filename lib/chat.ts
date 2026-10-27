/**
 * Asks OpenAI for one chat completion and returns the model's text. The caller
 * may pass earlier user and assistant turns; those are checked and capped, then
 * sent with the new message. The system prompt is added here and is never taken
 * from the caller. When the provider response includes usage, those token
 * counts are returned so the route can record them. The key is read from
 * OPENAI_API_KEY and is never returned. This file does not register tools,
 * look up an account, decide a refund, store the thread, or write a pending row.
 */

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Chat model that supports completions. Override with OPENAI_MODEL. */
export const DEFAULT_CHAT_MODEL = "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You are Northline Copilot, helping a support operator. Answer in one or two plain sentences. A short follow-up refers to the earlier turns in this conversation, so answer from that thread. You have no tools on this turn, so do not claim you looked up an account or queued a refund.";

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
  | { ok: true; reply: string; usage: TokenUsage | null }
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
): Promise<ChatTurnResult> {
  const apiKey = client.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, error: PUBLIC_ERROR, status: 500, reason: "not_configured" };
  }

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
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          { role: "user", content: message },
        ],
        max_completion_tokens: 300,
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

  const reply = redact(readReply(payload) ?? "", apiKey).trim();
  if (!reply) {
    return { ok: false, error: PUBLIC_ERROR, status: 502, reason: "upstream" };
  }

  return { ok: true, reply, usage: readUsage(payload) };
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
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;

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
