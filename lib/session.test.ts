/**
 * Checks the demo session helper: password match, HMAC sign and verify, expiry,
 * and cookie flags. These tests set process.env directly. They do not start
 * Next.js, set a cookie, read an account, or queue a refund.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_MAX_AGE_SECONDS,
  demoLoginConfigured,
  passwordMatchesDemo,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "./session";

const now = Date.parse("2026-10-24T12:00:00.000Z");

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

describe("demo session", () => {
  it("accepts only the configured demo password", () => {
    withEnv({ DEMO_PASSWORD: "northline-demo", SESSION_SECRET: "test-secret" }, () => {
      assert.equal(demoLoginConfigured(), true);
      assert.equal(passwordMatchesDemo("northline-demo"), true);
      assert.equal(passwordMatchesDemo("wrong"), false);
      assert.equal(passwordMatchesDemo(""), false);
    });
  });

  it("rejects a password when the demo env is missing", () => {
    withEnv({ DEMO_PASSWORD: undefined, SESSION_SECRET: undefined }, () => {
      assert.equal(demoLoginConfigured(), false);
      assert.equal(passwordMatchesDemo("northline-demo"), false);
      assert.equal(signSession(now), null);
      assert.equal(verifySession("demo.1.sig", now), false);
    });
  });

  it("signs a token the same secret can verify", () => {
    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const token = signSession(now);
      assert.ok(token);
      assert.equal(token.startsWith("demo."), true);
      assert.equal(token.includes("northline-demo"), false);
      assert.equal(verifySession(token, now), true);
      assert.equal(verifySession(token, now + (SESSION_MAX_AGE_SECONDS - 1) * 1000), true);
    });
  });

  it("rejects a tampered token, a different secret, and an expired token", () => {
    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const token = signSession(now);
      assert.ok(token);

      const [role, expText, signature] = token.split(".");
      assert.equal(verifySession(`${role}.${Number(expText) + 1}.${signature}`, now), false);
      assert.equal(verifySession(`${role}.${expText}.${signature}x`, now), false);
      assert.equal(verifySession(token, now + SESSION_MAX_AGE_SECONDS * 1000), false);
    });

    withEnv({ SESSION_SECRET: "test-secret" }, () => {
      const token = signSession(now);
      assert.ok(token);
      withEnv({ SESSION_SECRET: "other-secret" }, () => {
        assert.equal(verifySession(token, now), false);
      });
    });
  });

  it("sets an HttpOnly Lax cookie, Secure only in production", () => {
    withEnv({ NODE_ENV: "development" }, () => {
      const options = sessionCookieOptions();
      assert.equal(options.httpOnly, true);
      assert.equal(options.sameSite, "lax");
      assert.equal(options.path, "/");
      assert.equal(options.secure, false);
      assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS);
    });

    withEnv({ NODE_ENV: "production" }, () => {
      assert.equal(sessionCookieOptions().secure, true);
    });
  });
});
