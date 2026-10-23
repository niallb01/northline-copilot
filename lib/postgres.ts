/**
 * Opens a direct Postgres connection for server-side writes. It reads DATABASE_URL
 * and expects session mode on port 5432, then checks out one client so a transaction
 * stays on that connection while Node code runs. Day-to-day reads stay on the Supabase
 * client in lib/supabase.ts. This file does not apply refund rules or insert rows.
 */

import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Set DATABASE_URL to the session-mode Postgres URI (port 5432). Do not use the transaction pooler on port 6543.",
    );
  }

  const { local } = readLocation(connectionString);
  pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: local ? false : { rejectUnauthorized: false },
    application_name: "northline-copilot",
  });
  return pool;
}

function readLocation(connectionString: string): { local: boolean } {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(
      "DATABASE_URL must be a Postgres URI for session mode on port 5432. Percent-encode special characters in the password.",
    );
  }

  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && url.port === "6543") {
    throw new Error(
      "DATABASE_URL uses port 6543 (transaction pooler). Use session mode on port 5432 so one connection can hold the refund transaction.",
    );
  }
  if (!local && url.port !== "" && url.port !== "5432") {
    throw new Error(`DATABASE_URL port is ${url.port}. Use session mode on port 5432.`);
  }
  return { local };
}
