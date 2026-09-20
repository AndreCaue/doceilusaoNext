// POST /api/checkout — ORDER-02 reservation gate contract tests (Plan 30-06).
//
// NOTE (Rule 3 deviation): the plan's task 3 says "extend the existing
// checkout test file" — no checkout route test existed (glob
// `src/app/api/checkout/**/*.test.ts` was empty; phase 28/29 verified the
// route manually). This file is created instead and covers the gate semantics
// introduced by 30-06:
//
//   AUTH      → 401 D-12 shape + WWW-Authenticate BEFORE the gate runs
//              (getActiveReservation must not be called)
//   409 GATE  → getActiveReservation success:true → 409 ACTIVE_RESERVATION,
//              short-circuiting BEFORE any cart read or transaction
//   200 FLOW  → getActiveReservation success:false → full checkout flow
//              proceeds unchanged (cart find + interactive transaction)
//   5xx GATE  → getActiveReservation throwing → 500 INTERNAL_ERROR
//              (the lib contract says it never throws; a throw here is an
//              internal fault — the generic catch owns it)
//
// Invocation mirrors orders-api.test.ts: direct handler call with
// `new NextRequest(url, { method, headers, body })`; `@/lib/auth/guards`,
// `@/lib/orders/queries` and `@/lib/prisma` replaced with hoisted spies.
// The 200-case transaction callback is the route's REAL code — the tx mock
// only replaces the Prisma client, so the assertion pins the wire response.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { AuthError } from "@/lib/auth/jwt";
import type { HasOrderResult } from "@/lib/orders/queries";
import type { CheckoutRequest } from "@/lib/types/checkout";

import { POST as checkoutPOST } from "./route";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getActiveReservation: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
    cart: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/orders/queries", () => ({
  getActiveReservation: mocks.getActiveReservation,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Parity constants + fixtures ────────────────────────────────────────────
const USER_UUID = "48d2c3a1-9b4e-4f6d-a1c2-3d4e5f6a7b8c"; // identity uuid (v4)
const USER_ID = 7;
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c"; // order uuid (v4)
const ORDER_SHORT_ID = `P-${ORDER_UUID.slice(0, 5).toUpperCase()}`; // "P-5B3C2"
const RESERVATION_SECONDS = 6 * 60 * 60; // 21600 — CHECKOUT-03

const IDENTITY = {
  email: "fulano@example.com",
  scopes: [],
  is_verified: true,
  is_master: false,
  uuid: USER_UUID,
};

const ACTIVE_RESERVATION: HasOrderResult = {
  success: true,
  message: `Pedido aguardando pagamento ou já pago, aguarde o tempo para realizar outra compra! Pedido Nº #${ORDER_SHORT_ID}`,
  redirect: "/",
  expires_at: 123,
  expires_at_iso: "2026-09-16T13:30:00.000Z",
};

const NO_ORDER: HasOrderResult = {
  success: false,
  message: "",
  redirect: null,
  expires_at: 0,
  expires_at_iso: null,
};

// Valid against the route's checkoutSchema (zod, pydantic parity) — the gate
// must reject even perfectly valid requests while a reservation is live.
const VALID_BODY: CheckoutRequest = {
  recipient_name: "Fulano de Tal",
  recipient_document: "12345678909",
  recipient_email: "fulano@example.com",
  recipient_phone: "11987654321",
  street: "Rua das Flores",
  number: "123",
  complement: "Apto 42",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  postal_code: "01001000",
  shipping_option_id: 101,
  shipping_carrier: "Correios",
  shipping_method: "PAC",
  shipping_cost: 25.9,
  shipping_original: 25.9,
  shipping_delivery_days: 7,
};

const CART_FIXTURE = {
  id: 42,
  user_id: USER_ID,
  status: "active",
  items: [
    {
      id: 1,
      cart_id: 42,
      product_id: 101,
      product_name: "Baralho Bicycle",
      img_product: null as string | null,
      quantity: 1,
      unit_price: 134.0,
      total_price: 134.0,
      discount: 0,
    },
  ],
};

// tx mock — the route's REAL interactive-transaction callback runs against it.
const txMock = {
  $queryRaw: vi.fn().mockResolvedValue([
    { id: 101, stock: 10, reserved_stock: 0 },
  ]),
  order: {
    create: vi.fn().mockResolvedValue({
      id: 5,
      uuid: ORDER_UUID,
      user_id: USER_ID,
      status: "PENDING",
      payment_status: "PENDING",
    }),
  },
  orderItem: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  orderShipping: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  product: { update: vi.fn().mockResolvedValue({ id: 101 }) },
  cart: { update: vi.fn().mockResolvedValue({ id: 42 }) },
};

function authedPost(): NextRequest {
  return new NextRequest("http://localhost/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(VALID_BODY),
  });
}

beforeEach(() => {
  mocks.getCurrentUser.mockReset().mockResolvedValue(IDENTITY);
  mocks.getActiveReservation.mockReset();
  mocks.prisma.user.findUnique
    .mockReset()
    .mockResolvedValue({ id: USER_ID });
  mocks.prisma.cart.findFirst.mockReset();
  mocks.prisma.$transaction.mockReset();
});

describe("POST /api/checkout — auth prologue BEFORE the reservation gate", () => {
  it("unauthenticated → 401 D-12; gate query NOT called (no existence oracle)", async () => {
    mocks.getCurrentUser.mockReset().mockRejectedValue(
      new AuthError("Não autenticado", 401, "UNAUTHORIZED"),
    );

    const res = await checkoutPOST(authedPost());

    expect(res.status).toBe(401);
    expect(mocks.getActiveReservation).not.toHaveBeenCalled();
    expect(mocks.prisma.cart.findFirst).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: "Não autenticado",
      code: "UNAUTHORIZED",
      retryable: false,
    });
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
});

describe("POST /api/checkout — 409 ACTIVE_RESERVATION gate (T-30-06-01/02)", () => {
  it("live reservation → 409, short-circuit BEFORE cart read & transaction", async () => {
    mocks.getActiveReservation.mockResolvedValue(ACTIVE_RESERVATION);

    const res = await checkoutPOST(authedPost());

    expect(res.status).toBe(409);
    expect(mocks.getActiveReservation).toHaveBeenCalledWith(USER_ID);
    expect(mocks.prisma.cart.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: ACTIVE_RESERVATION.message,
      code: "ACTIVE_RESERVATION",
      retryable: false,
    });
  });

  it("gate query throws → 500 INTERNAL_ERROR (lib contract: never throws)", async () => {
    mocks.getActiveReservation.mockRejectedValue(new Error("db down"));

    const res = await checkoutPOST(authedPost());

    expect(res.status).toBe(500);
    expect(mocks.prisma.cart.findFirst).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: "Erro interno",
      code: "INTERNAL_ERROR",
      retryable: true,
    });
  });
});

describe("POST /api/checkout — no reservation → full flow proceeds unchanged", () => {
  it("success:false (NO_ORDER) → 200 { redirect, expires_in_seconds }", async () => {
    mocks.getActiveReservation.mockResolvedValue(NO_ORDER);
    mocks.prisma.cart.findFirst.mockResolvedValue(CART_FIXTURE);
    mocks.prisma.$transaction.mockImplementation(async (cb: (tx: typeof txMock) => unknown) =>
      cb(txMock),
    );

    const res = await checkoutPOST(authedPost());

    expect(res.status).toBe(200);
    expect(mocks.getActiveReservation).toHaveBeenCalledWith(USER_ID);
    expect(mocks.prisma.cart.findFirst).toHaveBeenCalledWith({
      where: { user_id: USER_ID, status: "active" },
      include: { items: true },
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.order.create).toHaveBeenCalledTimes(1);
    expect(txMock.cart.update).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toEqual({
      redirect: `/checkout/${ORDER_UUID}`,
      expires_in_seconds: RESERVATION_SECONDS,
    });
  });
});