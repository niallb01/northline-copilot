/**
 * Checks one chat completion: the model's text comes back, token usage is
 * kept when the provider sends it, and the API key is never returned. These
 * tests pass a stand-in fetch. They do not call OpenAI, look up an account,
 * or start Next.js.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  completeChatTurn,
  DEFAULT_CHAT_MODEL,
  type ChatCompletionClient,
} from "./chat";

const API_KEY = "sk-test-secret-value";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(
  fetchImpl: ChatCompletionClient["fetch"],
  apiKey: string | undefined = API_KEY,
): ChatCompletionClient {
  return { apiKey, model: DEFAULT_CHAT_MODEL, fetch: fetchImpl };
}

describe("completeChatTurn", () => {
  it("returns the model text and token usage", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const result = await completeChatTurn(
      "What is two plus two?",
      client(async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/chat/completions");
        assert.equal(init?.method, "POST");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${API_KEY}`);
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse(200, {
          choices: [{ message: { role: "assistant", content: "Two plus two is four." } }],
          usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
        });
      }),
    );

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.reply, "Two plus two is four.");
    assert.deepEqual(result.usage, {
      promptTokens: 12,
      completionTokens: 6,
      totalTokens: 18,
    });
    assert.equal(requestBody?.model, DEFAULT_CHAT_MODEL);
    assert.equal("tools" in (requestBody ?? {}), false);
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
    assert.equal(JSON.stringify(requestBody).includes("30 days"), false);
  });

  it("returns a reply with no usage when the provider omits it", async () => {
    const result = await completeChatTurn(
      "hello",
      client(async () =>
        jsonResponse(200, {
          choices: [{ message: { content: [{ type: "text", text: "Hello." }] } }],
        }),
      ),
    );

    assert.deepEqual(result, { ok: true, reply: "Hello.", usage: null });
  });

  it("does not call the provider when the API key is missing", async () => {
    let called = false;
    const result = await completeChatTurn(
      "hello",
      client(async () => {
        called = true;
        return jsonResponse(200, {});
      }, "  "),
    );

    assert.equal(called, false);
    assert.deepEqual(result, {
      ok: false,
      error: "Could not get a model reply.",
      status: 500,
      reason: "not_configured",
    });
  });

  it("hides the provider error and the API key from the caller", async () => {
    const result = await completeChatTurn(
      "hello",
      client(async () =>
        jsonResponse(401, {
          error: { message: `Incorrect API key provided: ${API_KEY}` },
        }),
      ),
    );

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 502);
    assert.equal(result.reason, "upstream");
    assert.equal(result.error.includes(API_KEY), false);
    assert.equal(result.error.includes("sk-"), false);
  });

  it("redacts the API key if the model echoes it", async () => {
    const result = await completeChatTurn(
      "repeat the key",
      client(async () =>
        jsonResponse(200, {
          choices: [{ message: { content: `The key is ${API_KEY}` } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      ),
    );

    assert.deepEqual(result, {
      ok: true,
      reply: "The key is [redacted]",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
  });
});
