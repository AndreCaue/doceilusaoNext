// POST /api/payment/refund-card — ORDER-04 money route (Plan 30-05).
//
// Thin gate stack over plan 30-02's `requestCardRefund`: NO business rules
// live here — every guarded check, the D-13 liveness probe, the Efí refund,
// and the locked state transition live in `@/lib/payments/refund.ts` (30-02),
// which this route's test suite keeps MOCKED.
//
// Pipeline order (each gate before the next — bypassing any gate is a test
// failure, T-30-05-01..05):
//   1. AUTH — getCurrentUser(req) (checkout-route prologue parity): AuthError →
//      401 D-12 shape { error, code, retryable: false } + WWW-Authenticate:
//      Bearer. The numeric user id resolves from the identity uuid via
//      prisma.user.findUnique (checkout route.ts:95-98 precedent —
//      UserIdentity carries only uuid; Order.user_id is an int FK).
//   2. RATE — per-IP 60/min sliding window BEFORE zod (bad bodies are attacks
//      too, T-30-05-03): 429 { error, code: "RATE_LIMITED", retryable: true,
//      retry_after_seconds }. Efí traffic happens only after ALL gates pass.
//   3. BODY — zod: order_uuid must be a UUID v4; amount optional, coerced
//      integer > 0 (T-30-05-04; the lib caps it at the order total with
//      REFUND_AMOUNT_INVALID).
//   4. LIB — requestCardRefund({ orderUuid, userId, amount? }): rejection
//      (REFUND_* codes, retryable: false) → stable status map; EfiError
//      transport failures → retryable ? 502 : 400 with the D-12 body as-is.
//   5. SUCCESS — 200 { ok: true, message } — the caller NEVER sees raw Efí
//      internals (T-30-05-05).
//
// Parity: Backend/app/payment/routes.py L158-192 (the #Feature route this
// refactors), D-12 rejection shape.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { rateLimit } from "@/lib/auth/rate-limit";
import { ip } from "@/lib/auth/ip";
import { requestCardRefund, type RefundRejection } from "@/lib/payments/refund";
import type { EfiError } from "@/lib/payments/types";

// ─── Zod body — routes.py RefundRequest parity (T-30-05-04) ────────────────
const refundBodySchema = z.object({
  order_uuid: z.string().uuid(),
  amount: z.coerce.number().int().positive().optional(),
});

// ─── Stable rejection → HTTP status map (D-12; fail-closed, never 5xx for a
// guarded refund refusal) ────────────────────────────────────────────────────
const REFUND_STATUS: Record<RefundRejection["code"], number> = {
  REFUND_NOT_FOUND: 404,
  REFUND_FORBIDDEN: 403,
  REFUND_NO_CHARGE: 400,
  REFUND_ALREADY_DONE: 409,
  REFUND_INVALID_STATUS: 409,
  REFUND_AMOUNT_INVALID: 400,
};

export async function POST(req: NextRequest) {
  try {
    // 1. Auth gate (checkout-route prologue copy).
    const identity = await getCurrentUser(req);

    // 2. Rate limit FIRST (T-30-05-03 — per-IP 60/min, D-12).
    const limited = rateLimit(`refund:${ip(req)}`, 60, 60_000);
    if (!limited.ok) {
      return NextResponse.json(
        {
          error: "Muitas requisições, tente novamente em instantes",
          code: "RATE_LIMITED",
          retryable: true,
          retry_after_seconds: limited.retryAfterSeconds,
        },
        { status: 429 },
      );
    }

    // 3. Zod body gate.
    const parsed = refundBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", code: "INVALID_BODY", retryable: false },
        { status: 400 },
      );
    }
    const { order_uuid, amount } = parsed.data;

    // Resolve the numeric user id from the identity uuid (checkout
    // route.ts:95-98 precedent — userId NEVER comes from the body,
    // T-30-05-02).
    const dbUser = await prisma.user.findUnique({
      where: { uuid: identity.uuid },
      select: { id: true },
    });
    if (!dbUser) {
      return NextResponse.json(
        { error: "Usuário não encontrado", code: "USER_NOT_FOUND", retryable: false },
        { status: 401 },
      );
    }

    // 4. Refund transition — every rule lives in refund.ts (30-02); thin call.
    const result = await requestCardRefund({
      orderUuid: order_uuid,
      userId: dbUser.id,
      ...(amount !== undefined ? { amount } : {}),
    });

    // 5. Success — thin 200, no Efí internals leaked (T-30-05-05).
    return NextResponse.json({ ok: true, message: result.message }, { status: 200 });
  } catch (err) {
    // Checkout-route prologue copy: AuthError → D-12 + WWW-Authenticate on 401.
    if (err instanceof AuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: false },
        {
          status: err.status,
          headers: err.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
        },
      );
    }

    // RefundRejection (D-12 shape, REFUND_* code, retryable: false) → the
    // stable status map; the rejection body passes through as-is.
    const rejection = err as Partial<RefundRejection>;
    if (
      rejection &&
      typeof rejection.code === "string" &&
      rejection.code.startsWith("REFUND_") &&
      rejection.retryable === false
    ) {
      const status = REFUND_STATUS[rejection.code as RefundRejection["code"]] ?? 500;
      return NextResponse.json(
        { error: rejection.error, code: rejection.code, retryable: false },
        { status },
      );
    }

    // EfiError transport failure (has code + retryable) → retryable ? 502 :
    // 400 — body as-is (D-12; the retryable flag is the caller's contract).
    const efi = err as Partial<EfiError>;
    if (
      efi &&
      typeof efi.error === "string" &&
      typeof efi.code === "string" &&
      typeof efi.retryable === "boolean"
    ) {
      return NextResponse.json(
        { error: efi.error, code: efi.code, retryable: efi.retryable },
        { status: efi.retryable ? 502 : 400 },
      );
    }

    return NextResponse.json(
      { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
      { status: 500 },
    );
  }
}