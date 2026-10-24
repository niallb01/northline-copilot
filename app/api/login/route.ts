/**
 * POST /api/login. Reads the password from the form body, asks lib/session
 * whether it matches DEMO_PASSWORD, and on a match sets the signed session
 * cookie. It ignores any Authorization header. It does not read accounts or
 * write a refund.
 */

import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  demoLoginConfigured,
  passwordMatchesDemo,
  sessionCookieOptions,
  signSession,
} from "../../../lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!demoLoginConfigured()) {
    return htmlResponse(
      "Demo login is not configured. Set DEMO_PASSWORD and SESSION_SECRET on the server.",
      500,
    );
  }

  const password = await readPassword(request);
  if (!passwordMatchesDemo(password)) {
    return htmlResponse(
      `That password did not match. <a href="/login">Back to login</a>`,
      401,
    );
  }

  const token = signSession();
  if (!token) {
    return htmlResponse(
      "Demo login is not configured. Set DEMO_PASSWORD and SESSION_SECRET on the server.",
      500,
    );
  }

  const response = NextResponse.redirect(new URL("/workspace", request.url), 303);
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions());
  return response;
}

async function readPassword(request: Request): Promise<string> {
  try {
    const form = await request.formData();
    const value = form.get("password");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function htmlResponse(body: string, status: number) {
  return new Response(`<!DOCTYPE html><html lang="en"><body><p>${body}</p></body></html>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
