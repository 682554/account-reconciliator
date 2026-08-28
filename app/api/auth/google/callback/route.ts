import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/googleSheets";
import { encryptSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, OAUTH_STATE_COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value;
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, request.nextUrl.origin));
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?error=invalid_oauth_state", request.nextUrl.origin));
  }

  try {
    const redirectUri = new URL("/api/auth/google/callback", request.nextUrl.origin).toString();
    const token = await exchangeCodeForToken(code, redirectUri);
    const sessionToken = await encryptSession({
      googleAccessToken: token.access_token,
      googleTokenExpiresAt: Date.now() + token.expires_in * 1000,
    });

    const response = NextResponse.redirect(new URL("/?connected=1", request.nextUrl.origin));
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
    response.cookies.delete(OAUTH_STATE_COOKIE_NAME);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=token_exchange_failed", request.nextUrl.origin));
  }
}
