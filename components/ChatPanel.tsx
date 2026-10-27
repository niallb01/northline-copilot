/**
 * Chat panel on the left of the workspace. The operator types a message, the
 * browser POSTs it to /api/chat, and the transcript shows that message plus
 * the model's reply. It does not call OpenAI itself, run a tool, decide a
 * refund, or read the session cookie.
 */

"use client";

import { useRef, useState, type FormEvent } from "react";
import { Panel } from "./Panel";
import styles from "./ChatPanel.module.css";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: number;
  role: ChatRole;
  text: string;
};

function isModelReply(value: unknown): value is { reply: string } {
  if (typeof value !== "object" || value === null) return false;
  const reply = (value as { reply?: unknown }).reply;
  return typeof reply === "string" && reply.trim().length > 0;
}

export function ChatPanel() {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const sendingRef = useRef(false);

  function appendMessage(role: ChatRole, text: string) {
    const id = nextId.current;
    nextId.current += 1;
    setMessages((current) => [...current, { id, role, text }]);
  }

  async function sendMessage(text: string) {
    const message = text.trim();
    if (!message || sendingRef.current) return;

    sendingRef.current = true;
    setDraft("");
    setError(null);
    setSending(true);
    appendMessage("user", message);

    const chatUrl = "/api/chat";
    const payload = { message };

    try {
      if (process.env.NODE_ENV === "development") {
        console.log("Chat send (POST /api/chat):", { url: chatUrl, body: payload });
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
      if (process.env.NODE_ENV === "development") {
        console.log("Chat reply (POST /api/chat):", {
          status: response.status,
          body,
        });
      }

      if (response.status === 401) {
        setError("Sign in required.");
        return;
      }

      if (!response.ok || !isModelReply(body)) {
        setError("Could not send that message.");
        return;
      }

      appendMessage("assistant", body.reply);
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
              Ask a question. The reply comes from the model.
            </p>
          ) : (
            <ol className={styles.list}>
              {messages.map((entry) => (
                <li
                  key={entry.id}
                  className={
                    entry.role === "user" ? styles.user : styles.assistant
                  }
                >
                  <span className={styles.role}>
                    {entry.role === "user" ? "You" : "Copilot"}
                  </span>
                  <p className={styles.bubble}>{entry.text}</p>
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
