/**
 * Chat panel on the left of the workspace. The operator types a message, the
 * browser POSTs that message plus earlier user and assistant turns to
 * /api/chat, and the transcript shows the message, any get_account,
 * list_charges, or preview_refund call with its arguments, and the model's
 * reply. When that reply includes an eligible proposal, it tells the workspace
 * so a person can confirm. The transcript lives in React state on this page.
 * It does not call OpenAI itself, run a tool, decide a refund, store the
 * thread on the server, read the session cookie, or confirm a refund.
 */

"use client";

import { useRef, useState, type FormEvent } from "react";
import type { ConfirmOffer } from "../lib/confirmOffer";
import { Panel } from "./Panel";
import styles from "./ChatPanel.module.css";

type ChatRole = "user" | "assistant";

type TranscriptEntry =
  | { id: number; kind: "user" | "assistant"; text: string }
  | { id: number; kind: "tool"; name: string; arguments: unknown };

type ToolCallView = {
  name: string;
  arguments: unknown;
};

function readModelReply(value: unknown): { reply: string; toolCalls: ToolCallView[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const reply = (value as { reply?: unknown }).reply;
  if (typeof reply !== "string" || !reply.trim()) return null;
  const rawCalls = (value as { toolCalls?: unknown }).toolCalls;
  return { reply: reply.trim(), toolCalls: readToolCalls(rawCalls) };
}

function readToolCalls(value: unknown): ToolCallView[] {
  if (!Array.isArray(value)) return [];
  const calls: ToolCallView[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string" || !name.trim()) continue;
    if (!("arguments" in item)) continue;
    calls.push({ name: name.trim(), arguments: (item as { arguments: unknown }).arguments });
  }
  return calls;
}

function readConfirmOffer(value: unknown): ConfirmOffer | null {
  if (typeof value !== "object" || value === null) return null;
  const proposal = (value as { proposal?: unknown }).proposal;
  if (typeof proposal !== "object" || proposal === null || Array.isArray(proposal)) return null;
  const row = proposal as Record<string, unknown>;
  if (row.action !== "request_refund") return null;
  if (typeof row.accountId !== "string" || typeof row.chargeId !== "string") return null;
  const accountId = row.accountId.trim();
  const chargeId = row.chargeId.trim();
  if (!accountId || !chargeId) return null;
  return { accountId, chargeId, action: "request_refund" };
}

function formatArguments(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function ChatPanel({
  onConfirmOffer,
}: {
  onConfirmOffer?: (offer: ConfirmOffer) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<TranscriptEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const sendingRef = useRef(false);

  function appendEntry(entry: {
    kind: "user" | "assistant";
    text: string;
  } | {
    kind: "tool";
    name: string;
    arguments: unknown;
  }) {
    const id = nextId.current;
    nextId.current += 1;
    setMessages((current) => [...current, { ...entry, id }]);
  }

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || sendingRef.current) return;

    sendingRef.current = true;
    setDraft("");
    setError(null);
    setSending(true);

    const history: { role: ChatRole; content: string }[] = [];
    for (const entry of messages) {
      if (entry.kind === "tool") continue;
      history.push({ role: entry.kind, content: entry.text });
    }
    appendEntry({ kind: "user", text: message });

    const chatUrl = "/api/chat";
    const payload = { message, history };

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("POST /api/chat", { method: "POST", url: chatUrl, body: payload });
      }

      const response = await fetch(chatUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const body: unknown = await response.json();

      if (response.status === 401) {
        setError("Sign in required.");
        return;
      }

      const reply = readModelReply(body);
      const offer = readConfirmOffer(body);
      if (process.env.NODE_ENV === "development") {
        console.log("POST /api/chat response", { status: response.status, body });
        console.log(offer ? "Refund confirm offered:" : "Refund confirm offered: none", offer);
        if (reply) {
          if (reply.toolCalls.length > 0) {
            for (const call of reply.toolCalls) {
              if (call.name === "preview_refund") {
                console.log("preview_refund called:", call.arguments);
              }
              console.log(`Chat tool called: ${call.name}`, call.arguments);
            }
          } else {
            console.log("Chat tool called: (none this turn)");
          }
          console.log("Chat assistant text:", reply.reply);
        } else {
          console.log("Chat reply body (unexpected):", body);
        }
      }

      if (!response.ok || !reply) {
        setError("Could not send that message.");
        return;
      }

      for (const call of reply.toolCalls) {
        appendEntry({ kind: "tool", name: call.name, arguments: call.arguments });
      }
      appendEntry({ kind: "assistant", text: reply.reply });
      if (offer) {
        if (process.env.NODE_ENV === "development") {
          console.log("Workspace confirm offer set:", offer);
        }
        onConfirmOffer?.(offer);
      }
    } catch {
      setError("Could not send that message.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft);
  }

  return (
    <Panel title="Chat" fill>
      <div className={styles.shell}>
        <div className={styles.transcript} role="log" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? (
            <p className={styles.empty}>
              Ask a question, look up an account, ask for its charges, or ask if a charge would be refundable. The reply comes from the model.
            </p>
          ) : (
            <ol className={styles.list}>
              {messages.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    entry.kind === "user"
                      ? styles.user
                      : entry.kind === "tool"
                        ? styles.tool
                        : styles.assistant
                  }
                >
                  <span className={styles.role}>
                    {entry.kind === "user" ? "You" : entry.kind === "tool" ? "Tool" : "Copilot"}
                  </span>
                  <p className={styles.bubble}>
                    {entry.kind === "tool" ? (
                      <>
                        <span className={styles.toolName}>{entry.name}</span>{" "}
                        <span className={styles.toolArgs}>{formatArguments(entry.arguments)}</span>
                      </>
                    ) : (
                      entry.text
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
        <form className={styles.composer} onSubmit={onSubmit}>
          <label className={styles.label} htmlFor="chat-message">
            Message
          </label>
          <div className={styles.row}>
            <input
              className={styles.input}
              id="chat-message"
              name="message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type a message"
              autoComplete="off"
              disabled={sending}
            />
            <button className={styles.button} type="submit" disabled={sending || !draft.trim()}>
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </Panel>
  );
}
