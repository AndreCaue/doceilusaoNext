// POST /api/auth/logout — port of Backend/app/auth/routes.py:492-521 (logout)
// with D-14's improvement: DB revocation of the user's refresh tokens (the
// backend only clears cookies — we do BOTH).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/logout.
// Prisma-direct revocation — no Python hop.
//
// Behavior parity (AUTH-04, D-14):
//   * authenticated by the refresh_token cookie (routes.py:497-498 +
//     dependencies.py:98-126 get_current_user_from_cookie)
//   * decode the refresh cookie — invalid/expired/wrong-type → 401 "Token
//     inválido"; user gone → 401 "Usuário não encontrado"
//   * REVOKE all the user's non-revoked refresh tokens (routes.py:499-503 —
//     updateMany revoked:false → true via revokeAllUserRefreshTokens from
//     26-01) — logout is SERVER-SIDE session termination, a replayed refresh
//     cookie dies on the next refresh (Threat T-26-05-04)
//   * clears BOTH auth cookies via clearAuthCookies (D-14 + routes.py:505-519
//     clears both; we reuse the D-03 attribute helper — httpOnly/lax, not the
//     backend's samesite=strict delete — session cookie parity per D-03)
//   * 200 { message: "Logout global realizado com sucesso" } (routes.py:521)
//
// Error contract: Phase 25 D-12 shape { error, code, retryable }.
// Note: no rate limit — backend logout has none.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { REFRESH_COOKIE, clearAuthCookies } from "@/lib/auth/cookies";
import { AuthError, decodeToken, revokeAllUserRefreshTokens } from "@/lib/auth/jwt";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // Cookie read — dependencies.py:99-104 parity (get_token_from_cookie).
    const refreshCookie = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshCookie) {
      return errorResponse("Refresh token ausente", "REFRESH_TOKEN_MISSING", 401);
    }
    const token = refreshCookie.replace("Bearer ", "");

    // Decode + claim checks — dependencies.py:112-120 parity. The backend's
    // cookie path decodes without a type check; we require type === "refresh"
    // (the refresh_token cookie is refresh-only — an access token placed there
    // must not authenticate the logout path).
    let email: string;
    try {
      const payload = await decodeToken(token);
      if (payload.type !== "refresh" || !payload.sub) {
        return errorResponse("Token inválido", "INVALID_TOKEN", 401);
      }
      email = payload.sub;
    } catch {
      return errorResponse("Token inválido", "INVALID_TOKEN", 401);
    }

    // User lookup — dependencies.py:122-125.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return errorResponse("Usuário não encontrado", "USER_NOT_FOUND", 401);
    }

    // D-14 server-side termination — revoke every active refresh token for
    // this user (routes.py:499-503; revokeAllUserRefreshTokens from Plan
    // 26-01, updateMany where revoked:false → true).
    await revokeAllUserRefreshTokens(user.id);

    // Clear BOTH cookies — D-14 + routes.py:505-519 (access_token AND
    // refresh_token; clearAuthCookies uses the D-03 attribute set, which is
    // the phase's cookie contract).
    const response = new NextResponse(
      JSON.stringify({ message: "Logout global realizado com sucesso" }),
      {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      },
    );
    clearAuthCookies(response);
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}