// POST /api/auth/forgot-password — port of Backend/app/auth/routes.py:141-169
// (forgot_password).
//
// Explicit route: shadows the Phase 25 catch-all proxy for
// /api/auth/forgot-password. Prisma-direct — no Python hop.
//
// Behavior parity (AUTH-06, D-09, D-11):
//   * body { email } validated with an inline zod schema (ForgotPasswordRequest
//     EmailStr parity) → 400 D-12 on malformed shape
//   * lookup LOWERCASES the submitted email (routes.py:150
//     `body.email.lower()` — fastapi EmailStr keeps case; the raw value is
//     never matched directly)
//   * unknown email → 200 generic message, NO email sent, NO 404 —
//     anti-enumeration (routes.py:153): the body is indistinguishable from the
//     success branch (Threat T-26-06-01)
//   * known email → createResetPasswordToken(user.uuid) (26-01 — 30min
//     password_reset JWT, sub = user_uuid) + sendResetPasswordEmail with
//     buildResetPasswordLink(token) → link targets the NEXT page
//     /redefinir-senha?token=... (D-09) with prod origin
//     https://doceilusao.store (D-11)
//   * email-send failure is LOGGED server-side AND still returns the 200
//     generic body — the response contract never reveals send state (the user
//     retries within 3/min). This deliberately DIFFERS from register's 500
//     EMAIL_SEND_FAILED: a 4xx/5xx here would leak account existence.
//     The send is fired WITHOUT awaiting it (BackgroundTask parity —
//     routes.py:169), so response LATENCY is flat across both branches too.
//   * 200 body is byte-identical in BOTH branches (routes.py:153/169 parity)
//
// Rate limit: forgot-password 3/min (routes.py:142 parity).
// Error contract: Phase 25 D-12 shape { error, code, retryable }.

import { NextResponse, type NextRequest } from "next/server";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  buildResetPasswordLink,
  sendResetPasswordEmail,
} from "@/lib/auth/emails";
import { ip } from "@/lib/auth/ip";
import { AuthError, createResetPasswordToken } from "@/lib/auth/jwt";
import { RATE_LIMITS, rateLimit } from "@/lib/auth/rate-limit";

function errorResponse(
  message: string,
  code: string,
  status: number,
  retryable = false,
) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

// Inline zod schema — ForgotPasswordRequest parity (schemas.py:23-24):
// `email: EmailStr`. zod strips unknown keys by default, matching Pydantic's
// extra="ignore" here (no extra=forbid on the backend schema).
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

// Anti-enumeration contract — byte-identical 200 in both branches
// (routes.py:153/169). Never vary this string.
const GENERIC_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos um link de recuperação.";

export async function POST(req: NextRequest) {
  try {
    // Body parse — malformed JSON → 400 D-12 (FastAPI ValidationError parity).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("JSON inválido", "BAD_REQUEST", 400);
    }

    // Email format check — routes.py:143 (ForgotPasswordRequest.EmailStr).
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("E-mail inválido", "BAD_REQUEST", 400);
    }

    // Rate limit BEFORE the existence probe — 3/min abates bulk enumeration
    // (routes.py:142 parity; Threat T-26-06-01).
    const rl = rateLimit(
      `forgot-password:${ip(req)}`,
      RATE_LIMITS["forgot-password"],
    );
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

    // LOWERED lookup — routes.py:150 `body.email.lower()` parity.
    //
    // Collision handling: the email column is a case-sensitive unique index,
    // so a lowercased twin can coexist with a legacy mixed-case row. EXACT
    // match FIRST (deterministic — the reset targets the twin owner's own row
    // and inbox), then mode-insensitive fallback ONLY when no exact row exists
    // (keeps legacy mixed-case rows registered before the write-boundary
    // normalization at register/route.ts:87 reachable through recovery too).
    // A plain findFirst with mode: "insensitive" alone would resolve
    // indeterminately by heap scan order when twins exist and misdirect the
    // reset email/token to the shadowed row. Only uuid + email are needed
    // (reset token embeds the uuid; the email is the inbox). findFirst (not
    // findUnique) is required: findUnique only accepts scalar equality on the
    // unique email field.
    const lowered = parsed.data.email.toLowerCase();
    const user =
      (await prisma.user.findFirst({
        where: { email: lowered },
        select: { uuid: true, email: true },
      })) ??
      (await prisma.user.findFirst({
        where: { email: { equals: lowered, mode: "insensitive" } },
        select: { uuid: true, email: true },
      }));

    if (!user) {
      // routes.py:153 — no email send, identical 200. A 404 here would confirm
      // account existence (Threat T-26-06-01).
      return NextResponse.json(
        { message: GENERIC_MESSAGE },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    // D-09: 30-min password_reset JWT (sub = user.uuid) — 26-01 helper.
    const resetToken = await createResetPasswordToken(user.uuid);

    // D-09/D-11: link → NEXT /redefinir-senha?token=..., prod origin
    // https://doceilusao.store (buildResetPasswordLink, emails.ts:245).
    //
    // FIRE-AND-FORGET parity: the backend schedules this send as a
    // BackgroundTask AFTER the response (routes.py:169). Awaiting the
    // SMTP/Resend round-trip inline would make the known-account branch's
    // response LATENCY measurably longer than the unknown branch's instant
    // return — an account existence oracle against the anti-enumeration
    // contract (Threat T-26-06-01). The pending promise drains on the event
    // loop after the response is flushed (self-hosted Node). Send failure:
    // LOG server-side and STILL return the generic 200 — the anti-enumeration
    // guarantee outranks surfacing the send state.
    sendResetPasswordEmail({
      toEmail: user.email,
      resetLink: buildResetPasswordLink(resetToken),
    }).catch((err) => {
      console.error(
        "[forgot-password] falha ao enviar e-mail de recuperação:",
        err,
      );
    });

    // routes.py:169 — SAME generic body as the unknown-email branch.
    return NextResponse.json(
      { message: GENERIC_MESSAGE },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[forgot-password] ERRO REAL:", err);
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}
