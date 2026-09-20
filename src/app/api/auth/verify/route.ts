// POST /api/auth/verify — port of Backend/app/auth/routes.py:93-138 (verify).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/verify.
// Authenticated via access token (header Bearer → access_token cookie fallback,
// D-01) — the shared-token contract from Plan 26-01: the cookie authenticates
// the code check without the SPA's localStorage hack.
//
// Behavior parity (AUTH-05, D-08):
//   * body { code } validated 4-10 chars (VerifyEmailRequest schemas.py:29-30)
//   * token must be type "access" (routes.py:102-103) — refresh/reset tokens
//     can never authorize verify (Threat T-26-04-04)
//   * PBKDF2-HMAC-SHA256 re-derivation (100 000 iters, 16-byte hex salt) —
//     exact backend algorithm, email_service.py:33-46 / routes.py:113-119
//   * timingSafeEqual comparison prevents a timing oracle on code guesses
//     (Threat T-26-04-03)
//   * 15-min expiry honored (null or past → "Código expirado")
//   * success clears verification_code/salt/code_expiry, sets is_verified
//
// Rate limit: verify 5/min. Error contract: D-12 shape { error, code, retryable }.

import { pbkdf2Sync, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getTokenFromRequest } from "@/lib/auth/guards";
import { ip } from "@/lib/auth/ip";
import { AuthError, decodeToken } from "@/lib/auth/jwt";
import { RATE_LIMITS, rateLimit } from "@/lib/auth/rate-limit";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

/** 401 with backend parity `WWW-Authenticate: Bearer` (guards.ts contract). */
function unauthorizedResponse(message: string, code: string) {
  return NextResponse.json(
    { error: message, code, retryable: false },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

export async function POST(req: NextRequest) {
  try {
    // Body parse — malformed JSON → 400 D-12 (FastAPI ValidationError parity).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("JSON inválido", "BAD_REQUEST", 400);
    }

    const code = (typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined);

    // VerifyEmailRequest parity: code required, 4-10 chars (schemas.py:30).
    if (typeof code !== "string" || code.length < 4 || code.length > 10) {
      return errorResponse("Código inválido", "BAD_REQUEST", 400);
    }

    // Rate limit — verify 5/min (routes.py:94 parity).
    const rl = rateLimit(`verify:${ip(req)}`, RATE_LIMITS.verify);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "Muitas tentativas. Tente novamente em instantes.",
          code: "RATE_LIMITED",
          retryable: true,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    // Auth — getTokenFromRequest (header Bearer → cookie fallback, D-01) then
    // decode. routes.py:101-106 parity:
    //   * missing token / undecodable → 401 "Token inválido" family
    //   * type !== "access" → 401 "Token inválido"
    //   * no sub → 401 "Usuário não autenticado"
    const token = getTokenFromRequest(req);
    if (!token) {
      return unauthorizedResponse("Não autenticado", "UNAUTHORIZED");
    }

    const payload = await decodeToken(token);
    if (payload.type !== "access") {
      return unauthorizedResponse("Token inválido", "INVALID_TOKEN");
    }
    if (!payload.sub) {
      return unauthorizedResponse("Usuário não autenticado", "UNAUTHORIZED");
    }

    const user = await prisma.user.findUnique({ where: { email: payload.sub } });
    if (!user) {
      // Token's email references no live user — identity is not established.
      return unauthorizedResponse("Usuário não autenticado", "UNAUTHORIZED");
    }

    if (!user.verification_code || !user.salt) {
      // routes.py:109-111 — verified user (or broken row) has no pending code.
      return errorResponse(
        "Usuário inválido ou sem código de verificação",
        "BAD_REQUEST",
        400,
      );
    }

    // PBKDF2 re-derivation — routes.py:113-119 exact algorithm. Node's pbkdf2
    // applies HMAC-SHA256 like Python's pbkdf2_hmac, so hex outputs match.
    const derived = pbkdf2Sync(code, Buffer.from(user.salt, "hex"), 100_000, 32, "sha256");

    // timingSafeEqual demands equal-length buffers (Threat T-26-04-03): a length
    // mismatch short-circuits to false WITHOUT throwing.
    const storedHash = Buffer.from(user.verification_code, "hex");
    const codeMatches =
      derived.length === storedHash.length &&
      storedHash.length > 0 &&
      timingSafeEqual(derived, storedHash);

    if (!codeMatches) {
      return errorResponse("Código incorreto", "BAD_REQUEST", 400);
    }

    // Expiry — null or past → "Código expirado" (routes.py:121-128).
    if (!user.code_expiry || new Date(user.code_expiry).getTime() < Date.now()) {
      return errorResponse("Código expirado", "BAD_REQUEST", 400);
    }

    // Success — clear code fields, set verified (routes.py:130-136 parity).
    await prisma.user.update({
      where: { id: user.id },
      data: {
        is_verified: true,
        verification_code: null,
        salt: null,
        code_expiry: null,
      },
    });

    // VerifyEmailResponse parity (schemas.py:32-33).
    return NextResponse.json({ message: "E-mail verificado com sucesso!" }, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      // decodeToken AuthErrors are 401 — carry WWW-Authenticate (backend parity).
      if (err.status === 401) {
        return unauthorizedResponse(err.message, err.code);
      }
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}