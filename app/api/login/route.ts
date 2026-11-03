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
    return loginErrorRedirect(request, "config");
  }

  const password = await readPassword(request);
  if (!passwordMatchesDemo(password)) {
    return loginErrorRedirect(request, "invalid");
  }

  const token = signSession();
  if (!token) {
    return loginErrorRedirect(request, "config");
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

function loginErrorRedirect(request: Request, code: "invalid" | "config") {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, 303);
}
