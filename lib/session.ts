/**
 * Shared demo login: compare a submitted password with DEMO_PASSWORD and sign
 * or check a session token with SESSION_SECRET. One operator, no user table,
 * and no Supabase Auth. This file does not set cookies, read accounts, or
 * queue a refund. The route handler is what writes the Set-Cookie header.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "northline_session";

/** Browser lifetime and the expiry baked into the signed token. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export type SessionCookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

export function demoLoginConfigured(): boolean {
  return Boolean(process.env.DEMO_PASSWORD && process.env.SESSION_SECRET);
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function passwordMatchesDemo(password: string): boolean {
  const expected = process.env.DEMO_PASSWORD;
  if (!expected) return false;

  const actualHash = createHash("sha256").update(password, "utf8").digest();
  const expectedHash = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualHash, expectedHash);
}

export function signSession(now = Date.now()): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = `demo.${exp}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;

  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [role, expText, signature] = parts;
  if (role !== "demo" || !/^\d+$/.test(expText)) return false;

  const expected = createHmac("sha256", secret).update(`${role}.${expText}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  const exp = Number(expText);
  if (!Number.isSafeInteger(exp)) return false;
  return exp > Math.floor(now / 1000);
}
