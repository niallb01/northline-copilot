/**
 * Server-only Supabase client for Northline. It reads SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY from the server environment. That key is the service-role
 * key: it bypasses row level security and must never be sent to the browser. This file
 * does not use a publishable key and does not insert pending refunds. Do not prefix
 * either variable with NEXT_PUBLIC_.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

let client: SupabaseClient | undefined;

export function getServerSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the server environment. Do not use a NEXT_PUBLIC_ prefix.",
    );
  }

  if (key.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is a publishable key. Use the service-role key, which must not be sent to the browser.",
    );
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    // Node 20 has no built-in WebSocket. Reads never open a realtime socket;
    // this only lets the client construct. Cast: `ws` typings don't match the client.
    realtime: { transport: ws as never },
  });

  return client;
}
