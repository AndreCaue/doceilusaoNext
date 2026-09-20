// POST /api/auth/refresh — port of Backend/app/auth/routes.py:302-399 (refresh
// token rotation).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/refresh.
// Prisma-direct rotation — no Python hop.
//
// Behavior parity (AUTH-03, D-13):
//   * reads the refresh_token cookie (request.cookies parity routes.py:308);
//     missing → 401 "Refresh token ausente"; optional "Bearer " prefix
//     stripped (backend .replace("Bearer ", "") parity, routes.py:312)
//   * decodeToken must yield type === "refresh" with jti + sub — else 401
//     "Token inválido" (routes.py:314-322)
//   * user by email → 401 "Usuário não encontrado" (routes.py:327-329)
//   * isRefreshTokenValid (non-revoked, non-expired, owned) → else 401
//     "Refresh token revogado ou expirado" (routes.py:331-333)
//   * ATOMIC rotation (routes.py:357-376): create new RefreshToken row AND
//     revoke old jti in ONE prisma.$transaction — a stolen old token dies on
//     first use (Threat T-26-05-02 replay abatement)
//   * re-sets BOTH cookies (D-01) with the new pair (D-03 attrs, 30d)
//   * 200 body: Token shape identical to login — the 26-09 auth provider
//     depends on this exact shape (access_token, token_type, scopes,
//     is_verified, is_master)
//
// Error contract: Phase 25 D-12 shape { error, code, retryable }.
// Note: no rate limit — backend refresh has none (the @limiter decorator is
// commented out on this route).

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { REFRESH_COOKIE, setAuthCookies } from "@/lib/auth/cookies";
import {
  AuthError,
  createAccessToken,
  createRefreshToken,
  decodeToken,
  isRefreshTokenValid,
} from "@/lib/auth/jwt";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // Cookie read — routes.py:308-310 parity.
    const refreshCookie = req.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshCookie) {
      return errorResponse("Refresh token ausente", "REFRESH_TOKEN_MISSING", 401);
    }
    const token = refreshCookie.replace("Bearer ", "");

    // Decode + claim checks — routes.py:314-322 parity. A signature/expiry
    // failure surfaces as "Token inválido" (AuthError from decodeToken is
    // caught and re-mapped to the parity message).
    let jti: string;
    let email: string;
    try {
      const payload = await decodeToken(token);
      if (payload.type !== "refresh" || !payload.jti || !payload.sub) {
        return errorResponse("Token inválido", "INVALID_TOKEN", 401);
      }
      jti = payload.jti;
      email = payload.sub;
    } catch {
      return errorResponse("Token inválido", "INVALID_TOKEN", 401);
    }

    // User lookup — routes.py:327-329.
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return errorResponse("Usuário não encontrado", "USER_NOT_FOUND", 401);
    }

    // DB validity — routes.py:331-333 (revoked/expired/not-owned → 401).
    if (!(await isRefreshTokenValid({ jti, userId: user.id }))) {
      return errorResponse("Refresh token revogado ou expirado", "REFRESH_TOKEN_INVALID", 401);
    }

    // Scopes normalization — routes.py:335-337 (JSON column: array OR string).
    const rawScopes = user.scopes;
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter((s): s is string => typeof s === "string")
      : typeof rawScopes === "string"
        ? rawScopes.split(",").filter(Boolean)
        : [];

    // 1. Mint new pair BEFORE revoking anything (routes.py:339-350).
    const newAccess = await createAccessToken({ email: user.email, scopes });
    const newRefresh = await createRefreshToken({ email: user.email });

    let newJti: string;
    let newExpiresAt: Date;
    try {
      const payload = await decodeToken(newRefresh);
      if (!payload.jti || !payload.exp) {
        throw new Error("novo refresh token sem jti/exp");
      }
      newJti = payload.jti;
      newExpiresAt = new Date(payload.exp * 1000);
    } catch {
      return errorResponse("Erro ao rotacionar refresh token", "INTERNAL_ERROR", 500, true);
    }

    // 2. Save new + revoke old atomically (routes.py:357-376 pattern).
    //
    // updateMany (not update) on the revoke keeps the backend's
    // `if old_token:` tolerance (routes.py:369-371): a jti that vanished
    // between validation and the transaction no-ops instead of rolling back
    // the fresh token — same atomicity, no race-explosive failure.
    try {
      await prisma.$transaction([
        prisma.refreshToken.create({
          data: { jti: newJti, user_id: user.id, expires_at: newExpiresAt, revoked: false },
        }),
        prisma.refreshToken.updateMany({ where: { jti }, data: { revoked: true } }),
      ]);
    } catch {
      return errorResponse("Erro ao rotacionar refresh token", "INTERNAL_ERROR", 500, true);
    }

    // is_master — routes.py:396-397 parity.
    const isMaster = user.role === "master" && scopes.includes("master");

    const tokenResponse = {
      access_token: newAccess,
      token_type: "bearer" as const,
      scopes,
      is_verified: user.is_verified === true,
      ...(isMaster ? { is_master: true } : {}),
    };

    // D-01: body + both cookies re-set (D-03 attrs, 30d maxAge).
    const response = new NextResponse(JSON.stringify(tokenResponse), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
    setAuthCookies(response, { accessToken: newAccess, refreshToken: newRefresh });
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}