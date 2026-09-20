// Cookie helpers — D-02/D-03 attribute parity with Backend routes.py:244-253
// (login) and :379-388 (refresh):
//   * names  : access_token / refresh_token (exact — backend reads these in
//              dependencies.py:41 / routes.py:308 during coexistence)
//   * httpOnly, secure in production, samesite=lax, path=/
//   * domain = .doceilusao.store in production only (D-03)
//   * maxAge 30 days on both (refresh-cookie window parity, routes.py:387)
//
// Threat T-26-01-04: httpOnly blocks JS reads, secure in prod, samesite=lax
// blocks cross-site POST cookie sends, domain restricted to the store domain.

import type { NextResponse } from "next/server";

import { isProduction, PROD_COOKIE_DOMAIN } from "@/lib/auth/config";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

type AuthCookieValues = {
  accessToken: string;
  refreshToken: string;
};

function cookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax" as const,
    path: "/",
    domain: isProduction ? PROD_COOKIE_DOMAIN : undefined,
    maxAge,
  };
}

/** Set both auth cookies on a NextResponse (login, refresh, register flows). */
export function setAuthCookies(response: NextResponse, values: AuthCookieValues): void {
  response.cookies.set(ACCESS_COOKIE, values.accessToken, cookieAttributes(THIRTY_DAYS_SECONDS));
  response.cookies.set(REFRESH_COOKIE, values.refreshToken, cookieAttributes(THIRTY_DAYS_SECONDS));
}

/** Clear both auth cookies (logout — maxAge 0 is the Next.js delete signal). */
export function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(ACCESS_COOKIE, "", cookieAttributes(0));
  response.cookies.set(REFRESH_COOKIE, "", cookieAttributes(0));
}