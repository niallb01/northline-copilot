/**
 * Checks the refund proposal cookie value: HMAC sign and read, expiry, and
 * HttpOnly cookie flags. These tests set process.env directly. They do not
 * start Next.js, set a cookie, run a tool, or insert a pending row.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  PROPOSAL_MAX_AGE_SECONDS,
  proposalCookieOptions,
  readProposal,
  signProposal,
} from "./proposal";

const now = Date.parse("2026-10-29T12:00:00.000Z");

const draft = {
  accountId: "acct-annual-ok",
  chargeId: "ch_annual_1",
  action: "request_refund" as const,
};

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    run();
  } finally {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("refund proposal", () => {
  it("signs a proposal the same secret can read", () => {
    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const signed = signProposal(draft, now);
      assert.ok(signed);
      assert.equal(signed.token.includes("request_refund"), false);
      assert.equal(signed.token.includes("acct-annual-ok"), false);

      const proposal = readProposal(signed.token, now);
      assert.deepEqual(proposal, {
        accountId: "acct-annual-ok",
        chargeId: "ch_annual_1",
        action: "request_refund",
        exp: Math.floor(now / 1000) + PROPOSAL_MAX_AGE_SECONDS,
      });
      assert.equal(
        readProposal(signed.token, now + (PROPOSAL_MAX_AGE_SECONDS - 1) * 1000)?.chargeId,
        "ch_annual_1",
      );
    });
  });

  it("returns nothing when the session secret is missing", () => {
    withEnv({ SESSION_SECRET: undefined }, () => {
      assert.equal(signProposal(draft, now), null);
      assert.equal(readProposal("payload.sig", now), null);
    });
  });

  it("rejects a tampered token, a different secret, and an expired token", () => {
    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const signed = signProposal(draft, now);
      assert.ok(signed);
      const token = signed.token;
      const dot = token.lastIndexOf(".");
      const payload = token.slice(0, dot);
      const signature = token.slice(dot + 1);

      assert.equal(readProposal(`${payload}.${signature}x`, now), null);
      assert.equal(readProposal(`${payload.slice(0, -2)}aa.${signature}`, now), null);
      assert.equal(readProposal(token, now + PROPOSAL_MAX_AGE_SECONDS * 1000), null);
    });

    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const signed = signProposal(draft, now);
      assert.ok(signed);
      withEnv({ SESSION_SECRET: "other-secret" }, () => {
        assert.equal(readProposal(signed.token, now), null);
      });
    });
  });

  it("rejects a payload whose action is not request_refund", () => {
    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const signed = signProposal(draft, now);
      assert.ok(signed);
      const payload = Buffer.from(
        JSON.stringify({
          accountId: "acct-annual-ok",
          chargeId: "ch_annual_1",
          action: "approve",
          exp: Math.floor(now / 1000) + 60,
        }),
        "utf8",
      ).toString("base64url");
      const signature = createHmac("sha256", "test-secret").update(payload).digest("base64url");
      assert.equal(readProposal(`${payload}.${signature}`, now), null);
    });
  });

  it("sets an HttpOnly Lax cookie, Secure only in production", () => {
    withEnv({ NODE_ENV: "development" }, () => {
      const options = proposalCookieOptions();
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, "lax");
      assert.equal(options.path, "/");
      assert.equal(options.secure, false);
      assert.equal(options.maxAge, PROPOSAL_MAX_AGE_SECONDS);
    });

    withEnv({ NODE_ENV: "production" }, () => {
      assert.equal(proposalCookieOptions().secure, true);
    });
  });
});
