/**
 * Checks the human confirm gate: a valid session, an unexpired unused
 * proposal, and a matching account, charge, and action. confirmed is ignored.
 * The queue function is a stub. These tests do not start Next.js or insert a
 * pending row.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmOfferFromProposal, REFUND_NOT_STARTED, REFUND_QUEUED } from "./confirmOffer";
import {
  confirmHttpBody,
  confirmRefund,
  readConfirmRequest,
  type ConfirmRefundInput,
} from "./confirmRefund";
import { PROPOSAL_MAX_AGE_SECONDS, signProposal } from "./proposal";
import type { QueueRefundInput } from "./refunds";
import { signSession } from "./session";
import type { RefundResult } from "./types";

const now = Date.parse("2026-10-29T12:00:00.000Z");

const draft = {
  accountId: "acct-double",
  chargeId: "ch_double_dup",
  action: "request_refund" as const,
};

function withEnv(vars: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const finish = () => {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  try {
    const result = run();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).then(
        () => {
          finish();
        },
        (error: unknown) => {
          finish();
          throw error;
        },
      );
    }
    finish();
  } catch (error) {
    finish();
    throw error;
  }
}

function stubQueue(overrides: Partial<RefundResult> = {}) {
  const calls: QueueRefundInput[] = [];
  const queueRefund = async (input: QueueRefundInput): Promise<RefundResult> => {
    calls.push(input);
    return {
      started: true,
      status: "pending",
      accountId: input.accountId,
      chargeId: input.chargeId,
      reason: "Refund started as pending for a person to approve. No money has been sent.",
      ...overrides,
    };
  };
  return { calls, queueRefund };
}

function input(
  sessionToken: string | null,
  proposalToken: string | undefined,
  overrides: Partial<ConfirmRefundInput> = {},
): ConfirmRefundInput {
  return {
    sessionToken: sessionToken ?? undefined,
    proposalToken,
    accountId: draft.accountId,
    chargeId: draft.chargeId,
    action: draft.action,
    now,
    ...overrides,
  };
}

describe("confirm refund", () => {
  it("ignores confirmed and still requires account, charge, and action", () => {
    assert.deepEqual(readConfirmRequest({ confirmed: true }), {
      error: "Account id, charge id, and action are required.",
    });
    assert.deepEqual(
      readConfirmRequest({
        accountId: " acct-double ",
        chargeId: " ch_double_dup ",
        action: " request_refund ",
        confirmed: true,
        confirmation_token: "forged",
      }),
      {
        accountId: "acct-double",
        chargeId: "ch_double_dup",
        action: "request_refund",
      },
    );
  });

  it("does not offer confirm for a rejected preview", () => {
    assert.equal(confirmOfferFromProposal(null), null);
    assert.deepEqual(
      confirmOfferFromProposal({
        accountId: "acct-double",
        chargeId: "ch_double_dup",
        action: "request_refund",
      }),
      {
        accountId: "acct-double",
        chargeId: "ch_double_dup",
        action: "request_refund",
      },
    );
  });

  it("does not queue without a session, even when a proposal matches", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const signed = signProposal(draft, now);
      assert.ok(signed);
      const { calls, queueRefund } = stubQueue();
      const result = await confirmRefund(input(null, signed.token), { queueRefund, used: new Set() });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 401);
      assert.equal(calls.length, 0);
      assert.deepEqual(confirmHttpBody(result), { ok: false, error: "Sign in required." });
    });
  });

  it("does not queue when the session has no proposal", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const session = signSession(now);
      assert.ok(session);
      const { calls, queueRefund } = stubQueue();
      const used = new Set<string>();
      const missing = await confirmRefund(input(session, undefined), { queueRefund, used });
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.equal(missing.status, 403);
      assert.equal(calls.length, 0);

      const expired = signProposal(draft, now);
      assert.ok(expired);
      const later = now + PROPOSAL_MAX_AGE_SECONDS * 1000;
      const stale = await confirmRefund(input(session, expired.token, { now: later }), {
        queueRefund,
        used,
      });
      assert.equal(stale.ok, false);
      if (!stale.ok) {
        assert.equal(stale.status, 403);
        assert.equal(stale.clearProposal, true);
      }
      assert.equal(calls.length, 0);
    });
  });

  it("does not queue when the body does not match the stored proposal", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const session = signSession(now);
      const signed = signProposal(draft, now);
      assert.ok(session && signed);
      const { calls, queueRefund } = stubQueue();
      const used = new Set<string>();
      const mismatch = await confirmRefund(
        input(session, signed.token, { chargeId: "ch_double_1", action: "approve" }),
        { queueRefund, used },
      );
      assert.equal(mismatch.ok, false);
      if (!mismatch.ok) {
        assert.equal(mismatch.status, 403);
        assert.equal(mismatch.clearProposal, false);
      }
      assert.equal(calls.length, 0);

      const matched = await confirmRefund(input(session, signed.token), { queueRefund, used });
      assert.equal(matched.ok, true);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0], { accountId: "acct-double", chargeId: "ch_double_dup" });
    });
  });

  it("queues once when the proposal matches, and a replay does not queue again", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const session = signSession(now);
      const signed = signProposal(draft, now);
      assert.ok(session && signed);
      const { calls, queueRefund } = stubQueue();
      const used = new Set<string>();
      const first = await confirmRefund(input(session, signed.token), { queueRefund, used });
      assert.equal(first.ok, true);
      if (!first.ok) return;
      assert.equal(first.started, true);
      assert.equal(first.clearProposal, true);
      assert.deepEqual(confirmHttpBody(first).message, REFUND_QUEUED);

      const replay = await confirmRefund(input(session, signed.token), { queueRefund, used });
      assert.equal(replay.ok, false);
      if (!replay.ok) assert.equal(replay.status, 403);
      assert.equal(calls.length, 1);
    });
  });

  it("says the refund was not started when the service rejects, and inserts nothing", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const session = signSession(now);
      const signed = signProposal(
        {
          accountId: "acct-monthly-late",
          chargeId: "ch_monthly_1",
          action: "request_refund",
        },
        now,
      );
      assert.ok(session && signed);
      const { calls, queueRefund } = stubQueue({
        started: false,
        status: "rejected",
        reason: "Monthly charge is 48 days old (past 14 days). Refund not started. Nothing was saved.",
      });
      const used = new Set<string>();
      const result = await confirmRefund(
        input(session, signed.token, {
          accountId: "acct-monthly-late",
          chargeId: "ch_monthly_1",
        }),
        { queueRefund, used },
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.started, false);
      assert.equal(result.clearProposal, true);
      assert.equal(calls.length, 1);
      assert.deepEqual(confirmHttpBody(result), {
        started: false,
        status: "rejected",
        accountId: "acct-monthly-late",
        chargeId: "ch_monthly_1",
        reason: "Monthly charge is 48 days old (past 14 days). Refund not started. Nothing was saved.",
        message: REFUND_NOT_STARTED,
      });

      const replay = await confirmRefund(
        input(session, signed.token, {
          accountId: "acct-monthly-late",
          chargeId: "ch_monthly_1",
        }),
        { queueRefund, used },
      );
      assert.equal(replay.ok, false);
      assert.equal(calls.length, 1);
    });
  });

  it("lets the operator retry when queueRefund throws", async () => {
    await withEnv({ SESSION_SECRET: "test-secret" }, async () => {
      const session = signSession(now);
      const signed = signProposal(draft, now);
      assert.ok(session && signed);
      const used = new Set<string>();
      let calls = 0;
      await assert.rejects(
        () =>
          confirmRefund(input(session, signed.token), {
            used,
            queueRefund: async () => {
              calls += 1;
              throw new Error("database unavailable");
            },
          }),
        /database unavailable/,
      );
      const { calls: queued, queueRefund } = stubQueue();
      const retried = await confirmRefund(input(session, signed.token), { queueRefund, used });
      assert.equal(retried.ok, true);
      assert.equal(calls, 1);
      assert.equal(queued.length, 1);
    });
  });
});
