/**
 * Writes one row to public.audit_logs for a tool call: the tool name, a JSON
 * object of arguments, a JSON object of the outcome, and whether a pending row
 * was created. Argument values that are API keys, tokens, or other secrets are
 * replaced before the insert. This file does not decide refunds, call queueRefund,
 * or insert a pending row.
 */

import { DatabaseError } from "pg";
import { withClient } from "./postgres";

export type AuditLogInput = {
  toolName: string;
  arguments: Record<string, unknown>;
  outcome: Record<string, unknown>;
  pendingRowCreated: boolean;
};

export type AuditWriter = (entry: AuditLogInput) => Promise<void>;

const SECRET_KEY =
  /api[_-]?key|secret|password|token|authorization|credential|cookie|bearer|service[_-]?role|(?:^|_)session(?:_|$)|session/i;

const SECRET_ENV = [
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "SESSION_SECRET",
  "DEMO_PASSWORD",
] as const;

export function toolNameForAudit(name: string): string {
  const trimmed = name.trim();
  return /^[a-z_][a-z0-9_]{0,40}$/.test(trimmed) ? trimmed : "unknown";
}

/** A JSON object safe to store. Non-objects become {}. Secret keys and values are removed. */
export function sanitizeAuditArguments(args: unknown): Record<string, unknown> {
  if (!isPlainObject(args)) return {};
  return sanitizeObject(args, 0);
}

export async function writeAuditLog(entry: AuditLogInput): Promise<void> {
  const toolName = toolNameForAudit(entry.toolName);
  const argumentsJson = sanitizeAuditArguments(entry.arguments);
  const outcome = sanitizeAuditArguments(entry.outcome);
  const pendingRowCreated = entry.pendingRowCreated === true;

  if (process.env.NODE_ENV === "development") {
    console.log("audit_logs write:", {
      tool_name: toolName,
      arguments: argumentsJson,
      outcome,
      pending_row_created: pendingRowCreated,
    });
  }

  try {
    await withClient(async (client) => {
      await client.query(
        `insert into public.audit_logs (tool_name, arguments, outcome, pending_row_created)
         values ($1, $2::jsonb, $3::jsonb, $4)`,
        [toolName, JSON.stringify(argumentsJson), JSON.stringify(outcome), pendingRowCreated],
      );
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const code = error instanceof DatabaseError ? error.code : "insert failed";
      console.log("audit_logs write failed:", code);
    }
    throw new Error("Could not write the audit log.");
  }
}

function sanitizeObject(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = sanitizeValue(child, depth + 1);
  }
  return out;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (isPlainObject(value)) return sanitizeObject(value, depth);
  return null;
}

function redactString(value: string): string {
  let next = value;
  for (const secret of configuredSecrets()) {
    if (next.includes(secret)) next = next.split(secret).join("[redacted]");
  }
  next = next.replace(
    /sk-[A-Za-z0-9_-]{8,}|sb_secret_[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/\S+|Bearer\s+\S+/gi,
    "[redacted]",
  );
  if (next.length > 500) next = `${next.slice(0, 500)}…`;
  return next;
}

function configuredSecrets(): string[] {
  const found: string[] = [];
  for (const name of SECRET_ENV) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) found.push(value);
  }
  return found;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
