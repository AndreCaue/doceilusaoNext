// POST /api/auth/resend-verification — port of Backend/app/auth/routes.py:34-61
// (resend_verification).
//
// Explicit route: shadows the Phase 25 catch-all proxy for
// /api/auth/resend-verification.
//
// Behavior parity (D-08):
//   * authenticated via access token — basic scope implicit: register grants
//     ["basic"], so the access-token gate + any user satisfies the backend's
//     `Security(get_current_user, scopes=["basic"])` contract
//   * already-verified → 400 "Conta já verificada."
//   * cool-down: code_expiry > now + 1 min → 429 "Aguarde antes de solicitar
//     um novo código." (routes.py:45-53 — the 15-min window is clamped so a
//     fresh code can be requested once per minute)
//   * generateAndSendVerification — send failure → 500 (new code hash and
//     expiry are persisted before the send, so the failed undelivered code
//     stays on the row until the next resend)
//   * 200 → { message: "Novo código enviado para o seu e-mail." }
//
// Rate limit: resend-verification 3/min (routes.py:35 parity).
// Error contract: D-12 shape { error, code, retryable }.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { generateAndSendVerification } from "@/lib/auth/emails";
import { getCurrentUser } from "@/lib/auth/guards";
import { ip } from "@/lib/auth/ip";
import { AuthError } from "@/lib/auth/jwt";
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
    // Rate limit BEFORE auth work — resend-verification 3/min (routes.py:35).
    const rl = rateLimit(`resend-verification:${ip(req)}`, RATE_LIMITS["resend-verification"]);
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

    // Identity gate — access-token based (guards.ts contract; 401 on
    // missing/invalid/wrong-type token, D-01 cookie fallback included).
    const identity = await getCurrentUser(req);

    if (identity.is_verified) {
      // routes.py:42-43 parity.
      return errorResponse("Conta já verificada.", "BAD_REQUEST", 400);
    }

    // Cool-down needs the DB code_expiry + the numeric id for the email
    // trigger — one targeted row read (identity itself came from guards.ts).
    const user = await prisma.user.findUnique({
      where: { email: identity.email },
      select: { id: true, code_expiry: true },
    });
    if (!user) {
      // Race: user deleted between the guard and here — same 401 semantics.
      return unauthorizedResponse("Usuário não autenticado", "UNAUTHORIZED");
    }

    // routes.py:45-53 — 429 when the current code still has > 1 min of life.
    if (user.code_expiry && new Date(user.code_expiry).getTime() > Date.now() + 60_000) {
      return errorResponse(
        "Aguarde antes de solicitar um novo código.",
        "RATE_LIMITED",
        429,
        true,
      );
    }

    // Fresh code — routes.py:55-59. generateAndSendVerification persists the
    // NEW hash/salt/expiry BEFORE the send attempt, so a send failure leaves
    // the new (undelivered) code on the row; the next resend replaces it.
    try {
      await generateAndSendVerification(user.id);
    } catch (err) {
      console.error("[resend-verification] falha ao enviar e-mail de verificação:", err);
      return errorResponse("Erro ao enviar e-mail", "EMAIL_SEND_FAILED", 500, true);
    }

    // routes.py:61 parity.
    return NextResponse.json(
      { message: "Novo código enviado para o seu e-mail." },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof AuthError) {
      // getCurrentUser AuthErrors are 401 — carry WWW-Authenticate (backend parity).
      if (err.status === 401) {
        return unauthorizedResponse(err.message, err.code);
      }
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}