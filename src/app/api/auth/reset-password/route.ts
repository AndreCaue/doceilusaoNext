// POST /api/auth/reset-password — port of Backend/app/auth/routes.py:172-192
// (reset_password).
//
// Explicit route: shadows the Phase 25 catch-all proxy for
// /api/auth/reset-password. Prisma-direct — no Python hop.
//
// Behavior parity (AUTH-07, D-09):
//   * body { token, new_password } validated with an inline zod STRICT schema —
//     ResetPasswordRequest extra="forbid" parity (schemas.py:29-33): ANY
//     unknown key → 400
//   * verifyResetPasswordToken(token) (26-01 — HS256 signature, 30-min expiry,
//     type === "password_reset" enforced, sub = user_uuid) → ANY token failure
//     (expired, bad signature, wrong type) → 400 "Token inválido ou expirado"
//     (routes.py:179 verify + plan 26-06 message contract; Threat T-26-06-02)
//   * user by uuid → 404 "Usuário não encontrado" (routes.py:181-183)
//   * hashPassword (bcrypt rounds 12 — password.ts) → prisma.user.update
//     { password, updated_at: now } (routes.py:185-188)
//   * 200 → { message: "Senha redefinida com sucesso!" } (routes.py:192)
//   * NO refresh-token revocation on reset (backend parity — routes.py:172-192
//     never touches refresh tokens; Threat T-26-06-04 accept, documented for
//     future hardening)
//
// Rate limit: reset-password 3/min (routes.py:173 parity).
// Error contract: Phase 25 D-12 shape { error, code, retryable }.

import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { ip } from "@/lib/auth/ip";
import { verifyResetPasswordToken } from "@/lib/auth/jwt";
import { hashPassword } from "@/lib/auth/password";
import { RATE_LIMITS, rateLimit } from "@/lib/auth/rate-limit";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

// Inline zod schema — ResetPasswordRequest parity (schemas.py:29-33):
// `token: str, new_password: str` + extra="forbid". .strict() rejects unknown
// keys, mirroring ConfigDict(extra="forbid"). min(1) keeps both fields
// non-empty (a blank token can never verify; a blank password would silently
// produce an unusable account).
const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    new_password: z.string().min(1),
  })
  .strict();

export async function POST(req: NextRequest) {
  try {
    // Body parse — malformed JSON → 400 D-12 (FastAPI ValidationError parity).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("JSON inválido", "BAD_REQUEST", 400);
    }

    // Shape + extra-key check — ResetPasswordRequest extra="forbid" parity.
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("Dados inválidos", "BAD_REQUEST", 400);
    }
    const { token, new_password: newPassword } = parsed.data;

    // bcrypt 72-byte limit — hashPassword throws past it (password.ts:20-23);
    // surface a clean 400 instead of the 500 fallthrough (register max-72
    // parity; Threat T-26-06-03).
    if (new TextEncoder().encode(newPassword).length > 72) {
      return errorResponse("Senha deve ter no máximo 72 caracteres", "BAD_REQUEST", 400);
    }

    // Rate limit BEFORE token verification — 3/min (routes.py:173 parity).
    const rl = rateLimit(`reset-password:${ip(req)}`, RATE_LIMITS["reset-password"]);
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

    // Token proof-of-possession — routes.py:179 verify_reset_password_token.
    // Every failure mode (expiry, bad signature, wrong type, missing sub)
    // collapses to the same 400 parity message (Threat T-26-06-02).
    let userUuid: string;
    try {
      userUuid = await verifyResetPasswordToken(token);
    } catch {
      return errorResponse("Token inválido ou expirado", "INVALID_TOKEN", 400);
    }

    // User by uuid — routes.py:181-183 parity. 404 leaks nothing beyond what
    // the token holder already knew (T-26-06-03 mitigation).
    const user = await prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { id: true },
    });
    if (!user) {
      return errorResponse("Usuário não encontrado", "USER_NOT_FOUND", 404);
    }

    // Re-hash with bcrypt and replace — routes.py:185-188 parity. No refresh
    // token revocation: the backend leaves existing sessions valid after a
    // reset (T-26-06-04 accept — parity over hardening this phase).
    const hashed = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, updated_at: new Date() },
    });

    // routes.py:192 parity.
    return NextResponse.json(
      { message: "Senha redefinida com sucesso!" },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Token AuthErrors are handled above; this fallthrough is for unexpected
    // server errors (Prisma, bcrypt internals) — D-12 500 shape.
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}