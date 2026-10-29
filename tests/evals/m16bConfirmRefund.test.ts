/**
 * M16b checkpoint. Posts to the confirm route on the local dev server and
 * checks pending_refunds. A matching human confirm of the duplicate charge
 * inserts one pending row. A rejected preview stores no proposal. A confirm
 * with no proposal, or with confirmed set and no proposal, inserts nothing.
 * A proposal the rules reject inserts nothing. This file does not call the
 * model or send money.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { confirmOfferFromProposal } from "../../lib/confirmOffer";
import { closePool, withClient } from "../../lib/postgres";
import { PROPOSAL_COOKIE_NAME, signProposal } from "../../lib/proposal";
import { SESSION_COOKIE_NAME } from "../../lib/session";
import { eligibleProposal, type ToolResult } from "../../lib/tools";

const base = process.env.M16B_BASE_URL ?? "http://127.0.0.1:3000";
const jar = new Map<string, string>();
let duplicateProposal = "";

type RowCounts = { total: number; pending: number };

describe("M16b confirm refund", { concurrency: 1, timeout: 60_000 }, () => {
  before(async () => {
    if (!process.env.DEMO_PASSWORD || !process.env.SESSION_SECRET) {
      throw new Error("Set DEMO_PASSWORD and SESSION_SECRET before posting to the confirm route.");
    }
    await deletePending(["ch_double_dup", "ch_monthly_1"]);
    await login();
  });

  after(async () => {
    try {
      await deletePending(["ch_double_dup", "ch_monthly_1"]);
    } finally {
      await closePool();
    }
  });

  it("does not queue when the confirm route has no session", async () => {
    const beforeCounts = await counts();
    const { status, body } = await postConfirm(
      {
        accountId: "acct-double",
        chargeId: "ch_double_dup",
        action: "request_refund",
        confirmed: true,
      },
      false,
    );
    assert.equal(status, 401);
    assert.deepEqual(body, { ok: false, error: "Sign in required." });
    assert.deepEqual(await counts(), beforeCounts);
    assert.equal(await countPending("ch_double_dup"), 0);
  });

  it("does not queue when confirmed is set and there is no proposal", async () => {
    const beforeCounts = await counts();
    jar.delete(PROPOSAL_COOKIE_NAME);

    const onlyFlag = await postConfirm({ confirmed: true });
    assert.equal(onlyFlag.status, 400);
    assert.deepEqual(await counts(), beforeCounts);

    const withIds = await postConfirm({
      confirmed: true,
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      action: "request_refund",
    });
    assert.equal(withIds.status, 403);
    assert.equal(jar.has(PROPOSAL_COOKIE_NAME), false);
    assert.deepEqual(await counts(), beforeCounts);
    assert.equal(await countPending("ch_double_dup"), 0);
    console.log("confirmed: true with no proposal → no row");
  });

  it("does not offer confirm for a rejected preview, and inserts no row", async () => {
    const beforeCounts = await counts();
    const { status, body, setCookies } = await postTools("preview_refund", {
      account_id: "acct-monthly-late",
      charge_id: "ch_monthly_1",
    });
    assert.equal(status, 200);
    assert.equal(setCookies.some((line) => line.startsWith(`${PROPOSAL_COOKIE_NAME}=`)), false);
    assert.equal(jar.has(PROPOSAL_COOKIE_NAME), false);
    const result = asToolResult(body);
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "rejected");
    }
    assert.equal(confirmOfferFromProposal(eligibleProposal(result)), null);
    assert.equal(JSON.stringify(body).toLowerCase().includes("token"), false);
    assert.deepEqual(await counts(), beforeCounts);
    assert.equal(await countPending("ch_monthly_1"), 0);
    console.log("acct-monthly-late / ch_monthly_1 preview → rejected, confirm not offered, no row");
  });

  it("previews the duplicate without inserting, then one confirm queues one pending row", async () => {
    const beforeCounts = await counts();
    const preview = await postTools("preview_refund", {
      account_id: "acct-double",
      charge_id: "ch_double_dup",
    });
    assert.equal(preview.status, 200);
    const result = asToolResult(preview.body);
    assert.equal(result.ok, true);
    if (result.ok && result.tool === "preview_refund") {
      assert.equal(result.result.status, "pending");
    }
    assert.deepEqual(confirmOfferFromProposal(eligibleProposal(result)), {
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      action: "request_refund",
    });
    assert.deepEqual(await counts(), beforeCounts);
    duplicateProposal = jar.get(PROPOSAL_COOKIE_NAME) ?? "";
    assert.ok(duplicateProposal);

    const mismatch = await postConfirm({
      accountId: "acct-double",
      chargeId: "ch_double_1",
      action: "request_refund",
      confirmed: true,
    });
    assert.equal(mismatch.status, 403);
    assert.equal(jar.get(PROPOSAL_COOKIE_NAME), duplicateProposal);
    assert.equal(await countPending("ch_double_dup"), 0);
    assert.equal(await countPending("ch_double_1"), 0);

    const queued = await postConfirm({
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      action: "request_refund",
      confirmed: true,
    });
    assert.equal(queued.status, 200);
    assert.equal(queued.body.started, true);
    assert.equal(queued.body.status, "pending");
    assert.equal(queued.body.message, "Refund queued for review. No money has been sent.");
    assert.equal(jar.has(PROPOSAL_COOKIE_NAME), false);
    assert.equal(await countPending("ch_double_dup"), 1);
    console.log("acct-double / ch_double_dup confirm → one pending row");

    jar.set(PROPOSAL_COOKIE_NAME, duplicateProposal);
    const replay = await postConfirm({
      accountId: "acct-double",
      chargeId: "ch_double_dup",
      action: "request_refund",
      confirmed: true,
    });
    assert.equal(replay.status, 403);
    assert.equal(await countPending("ch_double_dup"), 1);
    console.log("replay of the used proposal → still one pending row");
  });

  it("inserts nothing when the service rejects the stored proposal", async () => {
    const signed = signProposal({
      accountId: "acct-monthly-late",
      chargeId: "ch_monthly_1",
      action: "request_refund",
    });
    assert.ok(signed);
    jar.set(PROPOSAL_COOKIE_NAME, signed.token);
    const { status, body } = await postConfirm({
      accountId: "acct-monthly-late",
      chargeId: "ch_monthly_1",
      action: "request_refund",
      confirmed: true,
    });
    assert.equal(status, 200);
    assert.equal(body.started, false);
    assert.equal(body.status, "rejected");
    assert.equal(body.message, "The refund was not started.");
    assert.equal(await countPending("ch_monthly_1"), 0);
    console.log("acct-monthly-late / ch_monthly_1 confirm → rejected, no row");
  });

  it("does not queue when the model asks the tools route to request a refund", async () => {
    const beforePending = await countPending("ch_double_dup");
    const { status, body } = await postTools("request_refund", {
      account_id: "acct-double",
      charge_id: "ch_double_dup",
      confirmed: true,
    });
    assert.equal(status, 400);
    assert.deepEqual(body, { ok: false, tool: "request_refund", error: "Unknown tool." });
    assert.equal(await countPending("ch_double_dup"), beforePending);
  });
});

async function login() {
  const form = new FormData();
  form.set("password", process.env.DEMO_PASSWORD ?? "");
  let response: Response;
  try {
    response = await fetch(`${base}/api/login`, {
      method: "POST",
      body: form,
      redirect: "manual",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    throw new Error(`Confirm route is not reachable at ${base} (${message}). Start npm run dev.`);
  }
  assert.equal(response.status, 303, "demo login did not accept the password");
  storeCookies(response);
  assert.ok(jar.has(SESSION_COOKIE_NAME));
}

async function postConfirm(payload: unknown, sendCookies = true) {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (sendCookies) headers.cookie = cookieHeader();
  const response = await fetch(`${base}/api/refunds/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const body = await readObject(response);
  storeCookies(response);
  return { status: response.status, body };
}

async function postTools(name: string, args: unknown) {
  const response = await fetch(`${base}/api/tools`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie: cookieHeader(),
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body: unknown = await response.json();
  const setCookies = setCookieLines(response);
  storeCookies(response);
  return { status: response.status, body, setCookies };
}

function cookieHeader(): string {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeCookies(response: Response) {
  for (const line of setCookieLines(response)) {
    const [pair, ...attrs] = line.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    const cleared = value.length === 0 || attrs.some((attr) => /^max-age=0$/i.test(attr));
    if (cleared) jar.delete(name);
    else jar.set(name, value);
  }
}

function setCookieLines(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") return response.headers.getSetCookie();
  return [];
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Confirm route did not return a JSON object.");
  }
  return body as Record<string, unknown>;
}

function asToolResult(value: unknown): ToolResult {
  if (typeof value !== "object" || value === null) {
    throw new Error("Tool route did not return a JSON object.");
  }
  return value as ToolResult;
}

async function counts(): Promise<RowCounts> {
  return withClient(async (client) => {
    const result = await client.query<RowCounts>(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'pending')::int as pending
       from public.pending_refunds`,
    );
    const row = result.rows[0];
    if (!row || typeof row.total !== "number" || typeof row.pending !== "number") {
      throw new Error("Pending count from the database was not a number.");
    }
    return row;
  });
}

async function countPending(chargeId: string): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n
       from public.pending_refunds
       where charge_id = $1 and status = 'pending'`,
      [chargeId],
    );
    const count = result.rows[0]?.n;
    if (typeof count !== "number") throw new Error("Pending count was not a number.");
    return count;
  });
}

async function deletePending(chargeIds: string[]): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `delete from public.pending_refunds
       where charge_id = any($1::text[]) and status = 'pending'`,
      [chargeIds],
    );
  });
}
