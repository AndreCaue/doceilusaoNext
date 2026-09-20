// POST /api/payment/refund-card route contract tests (Plan 30-05, TDD RED).
//
// Parity targets (30-CONTEXT D-12; Python `Backend/app/payment/routes.py`
// L158-192 — the `#Feature` refund-card route; consumes plan 30-02's
// `requestCardRefund` from `@/lib/payments/refund` — MOCKED here, so the route
// must stay a thin gate stack and never re-implement business rules):
//
//   PIPELINE ORDER (each gate before the next — bypassing any gate is a test
//   failure; T-30-05-01..05):
//     1. AUTH     — getCurrentUser throws AuthError → 401 D-12 shape +
//                   WWW-Authenticate: Bearer; requestCardRefund NOT called.
//     2. RATE     — 61st call from the same IP within 60s → 429
//                   { error, code: "RATE_LIMITED", retryable: true,
//                   retry_after_seconds }; requestCardRefund NOT called.
//                   (D-12 60/min per IP, BEFORE zod — bad bodies are attacks.)
//     3. BODY     — zod: missing body → 400 INVALID_BODY; non-UUID
//                   order_uuid → 400; amount non-integer/negative/zero → 400;
//                   valid body passes through to requestCardRefund.
//     4. MAPPING  — every RefundRejection code maps to a STABLE status:
//                   REFUND_NOT_FOUND 404 · REFUND_FORBIDDEN 403 ·
//                   REFUND_NO_CHARGE 400 · REFUND_ALREADY_DONE 409 ·
//                   REFUND_INVALID_STATUS 409 · REFUND_AMOUNT_INVALID 400 —
//                   the rejection's { error, code, retryable: false } body
//                   passes through as-is. EfiError retryable:true
//                   (EFI_UNREACHABLE) → 502 body as-is; EfiError
//                   retryable:false (EFI_INVALID_REQUEST) → 400 body as-is.
//     5. SUCCESS  — 200 { ok: true, message } — NO Efí internals leak
//                   (T-30-05-05).
//
//   WIRING — requestCardRefund receives { orderUuid, userId: 7, amount }: the
//   numeric user id resolves from the session IDENTITY uuid via
//   prisma.user.findUnique (checkout route.ts:95-98 precedent — UserIdentity
//   carries only uuid), NEVER from the request body (T-30-05-02).
//
// NOTE on the ip mock: `@/lib/auth/ip` exports `ip(req)` (not `getClientIp`).
// The mock pins the rate-limit key per test; the 60-burst test switches to a
// dedicated IP so the burst never contaminates the shared default key (the
// limiter's hit map is module-level).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { AuthError } from "@/lib/auth/jwt";
import type { RefundRejection } from "@/lib/payments/refund";
import type { EfiError } from "@/lib/payments/types";

import { POST } from "@/app/api/payment/refund-card/route";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requestCardRefund: vi.fn(),
  ip: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/payments/refund", () => ({
  requestCardRefund: mocks.requestCardRefund,
}));

vi.mock("@/lib/auth/ip", () => ({
  ip: mocks.ip,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Parity constants + fixtures ────────────────────────────────────────────
const USER_UUID = "48d2c3a1-9b4e-4f6d-a1c2-3d4e5f6a7b8c"; // identity uuid (v4)
const USER_ID = 7;
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c"; // order uuid (v4)
const DEFAULT_IP = "203.0.113.7"; // stable per-test rate-limit key
const BURST_IP = "198.51.100.9"; // dedicated key for the 60-burst test

const IDENTITY = {
  email: "fulano@example.com",
  scopes: [],
  is_verified: true,
  is_master: false,
  uuid: USER_UUID,
};

const SUCCESS_RESULT = {
  status: "success" as const,
  message: "Estorno solicitado com sucesso",
  response: { code: 200 },
};

const REFUSED: Record<RefundRejection["code"], { error: string; status: number }> = {
  REFUND_NOT_FOUND: { error: "Pedido não encontrado", status: 404 },
  REFUND_FORBIDDEN: { error: "Sem permissão", status: 403 },
  REFUND_NO_CHARGE: { error: "Pedido sem cobrança de cartão", status: 400 },
  REFUND_ALREADY_DONE: { error: "Estorno já realizado", status: 409 },
  REFUND_INVALID_STATUS: { error: "Status inválido para estorno: new", status: 409 },
  REFUND_AMOUNT_INVALID: { error: "Amount deve ser positivo em centavos", status: 400 },
};

function rejection(code: RefundRejection["code"]): RefundRejection {
  return { error: REFUSED[code].error, code, retryable: false };
}

function callRefund(body?: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/payment/refund-card", {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

beforeEach(() => {
  mocks.getCurrentUser.mockReset().mockResolvedValue(IDENTITY);
  mocks.requestCardRefund.mockReset().mockResolvedValue(SUCCESS_RESULT);
  mocks.ip.mockReset().mockReturnValue(DEFAULT_IP);
  mocks.prisma.user.findUnique.mockReset().mockResolvedValue({ id: USER_ID });
});

describe("POST /api/payment/refund-card — auth gate (T-30-05-02)", () => {
  it("unauthenticated → 401 D-12 + WWW-Authenticate; requestCardRefund NOT called", async () => {
    mocks.getCurrentUser.mockReset().mockRejectedValue(
      new AuthError("Não autenticado", 401, "UNAUTHORIZED"),
    );

    const res = await callRefund({ order_uuid: ORDER_UUID });

    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    await expect(res.json()).resolves.toEqual({
      error: "Não autenticado",
      code: "UNAUTHORIZED",
      retryable: false,
    });
    expect(mocks.requestCardRefund).not.toHaveBeenCalled();
  });
});

describe("POST /api/payment/refund-card — rate limit (T-30-05-03)", () => {
  it("61st call from the same IP within 60s → 429 RATE_LIMITED; requestCardRefund NOT called", async () => {
    mocks.ip.mockReturnValue(BURST_IP); // dedicated key — never poisons other tests

    for (let i = 0; i < 60; i += 1) {
      const res = await callRefund({ order_uuid: ORDER_UUID });
      expect(res.status).toBe(200);
    }
    expect(mocks.requestCardRefund).toHaveBeenCalledTimes(60);

    const res = await callRefund({ order_uuid: ORDER_UUID });
    expect(res.status).toBe(429);
    expect(mocks.requestCardRefund).toHaveBeenCalledTimes(60); // 61st not forwarded

    const body = await res.json();
    expect(body).toMatchObject({
      error: "Muitas requisições, tente novamente em instantes",
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(body.retry_after_seconds).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/payment/refund-card — zod body gate (T-30-05-04)", () => {
  it("missing body → 400 INVALID_BODY; requestCardRefund NOT called", async () => {
    const res = await callRefund();

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Dados inválidos",
      code: "INVALID_BODY",
      retryable: false,
    });
    expect(mocks.requestCardRefund).not.toHaveBeenCalled();
  });

  it("order_uuid not a UUID → 400 INVALID_BODY; requestCardRefund NOT called", async () => {
    const res = await callRefund({ order_uuid: "not-a-uuid" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Dados inválidos",
      code: "INVALID_BODY",
      retryable: false,
    });
    expect(mocks.requestCardRefund).not.toHaveBeenCalled();
  });

  it.each([12.5, -1, 0])("amount %p (non-positive integer) → 400 INVALID_BODY", async (amount) => {
    const res = await callRefund({ order_uuid: ORDER_UUID, amount });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Dados inválidos",
      code: "INVALID_BODY",
      retryable: false,
    });
    expect(mocks.requestCardRefund).not.toHaveBeenCalled();
  });

  it("valid body without amount → requestCardRefund called without amount (full refund)", async () => {
    const res = await callRefund({ order_uuid: ORDER_UUID });

    expect(res.status).toBe(200);
    expect(mocks.requestCardRefund).toHaveBeenCalledWith({
      orderUuid: ORDER_UUID,
      userId: USER_ID,
    });
  });
});

describe.each([
  ["REFUND_NOT_FOUND", 404],
  ["REFUND_FORBIDDEN", 403],
  ["REFUND_NO_CHARGE", 400],
  ["REFUND_ALREADY_DONE", 409],
  ["REFUND_INVALID_STATUS", 409],
  ["REFUND_AMOUNT_INVALID", 400],
] as const)("POST /api/payment/refund-card — rejection mapping: %s", (code, status) => {
  it(`→ ${status} with the rejection body passthrough (D-12)`, async () => {
    mocks.requestCardRefund.mockReset().mockRejectedValue(rejection(code));

    const res = await callRefund({ order_uuid: ORDER_UUID });

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({
      error: REFUSED[code].error,
      code,
      retryable: false,
    });
  });
});

describe("POST /api/payment/refund-card — Efí transport failures", () => {
  it("EfiError retryable:true (EFI_UNREACHABLE) → 502 body as-is", async () => {
    const err: EfiError = {
      error: "Efí indisponível",
      code: "EFI_UNREACHABLE",
      retryable: true,
    };
    mocks.requestCardRefund.mockReset().mockRejectedValue(err);

    const res = await callRefund({ order_uuid: ORDER_UUID });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual(err);
  });

  it("EfiError retryable:false (EFI_INVALID_REQUEST) → 400 body as-is", async () => {
    const err: EfiError = {
      error: "Falha no estorno: Erro desconhecido",
      code: "EFI_INVALID_REQUEST",
      retryable: false,
    };
    mocks.requestCardRefund.mockReset().mockRejectedValue(err);

    const res = await callRefund({ order_uuid: ORDER_UUID });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(err);
  });
});

describe("POST /api/payment/refund-card — success", () => {
  it("200 { ok: true, message } — no Efí internals leak (T-30-05-05)", async () => {
    const res = await callRefund({ order_uuid: ORDER_UUID, amount: 5000 });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      message: "Estorno solicitado com sucesso",
    });
  });
});

describe("POST /api/payment/refund-card — wiring (userId from the session, never the body)", () => {
  it("requestCardRefund called with { orderUuid, userId: 7, amount }", async () => {
    const res = await callRefund({ order_uuid: ORDER_UUID, amount: 5000 });

    expect(res.status).toBe(200);
    expect(mocks.requestCardRefund).toHaveBeenCalledWith({
      orderUuid: ORDER_UUID,
      userId: USER_ID,
      amount: 5000,
    });
    // The numeric id resolves via the identity-uuid lookup (checkout
    // route.ts:95-98 precedent) — the body can never inject a user id.
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { uuid: USER_UUID },
      select: { id: true },
    });
  });
});