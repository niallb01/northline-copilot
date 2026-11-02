/**
 * Writes one row to public.chat_token_usage for a chat turn: prompt tokens,
 * completion tokens, and total tokens from the OpenAI usage object. It stores
 * those three counts only. This file does not store the message, call OpenAI,
 * decide a refund, or insert a pending row.
 */

import { DatabaseError } from "pg";
import type { TokenUsage } from "./chat";
import { withClient } from "./postgres";

export type StoredTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** The three counts to store, or null when any count is missing or not a whole number >= 0. */
export function tokenCountsForStorage(usage: TokenUsage): StoredTokenUsage | null {
  const promptTokens = readCount(usage.promptTokens);
  const completionTokens = readCount(usage.completionTokens);
  const totalTokens = readCount(usage.totalTokens);
  if (promptTokens === null || completionTokens === null || totalTokens === null) return null;
  return { promptTokens, completionTokens, totalTokens };
}

export async function writeChatTokenUsage(usage: TokenUsage): Promise<StoredTokenUsage> {
  const counts = tokenCountsForStorage(usage);
  if (!counts) {
    throw new Error("Could not store token usage.");
  }

  if (process.env.NODE_ENV === "development") {
    console.log("chat_token_usage write:", {
      prompt_tokens: counts.promptTokens,
      completion_tokens: counts.completionTokens,
      total_tokens: counts.totalTokens,
    });
  }

  try {
    await withClient(async (client) => {
      await client.query(
        `insert into public.chat_token_usage (prompt_tokens, completion_tokens, total_tokens)
         values ($1, $2, $3)`,
        [counts.promptTokens, counts.completionTokens, counts.totalTokens],
      );
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const code = error instanceof DatabaseError ? error.code : "insert failed";
      console.log("chat_token_usage write failed:", code);
    }
    throw new Error("Could not store token usage.");
  }

  return counts;
}

function readCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}
