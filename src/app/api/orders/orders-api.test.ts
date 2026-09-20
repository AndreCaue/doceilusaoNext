// Order API route contract tests (Plan 30-03, TDD RED).
//
// Parity targets (30-CONTEXT D-07; Python `Backend/app/store/orders/routes.py`
// + `schemas.py`; consumes plan 30-01's read layer via `@/lib/orders/queries`):
//
//   AUTH — every route 401s unauthenticated callers with the D-12 shape
//   `{ error, code, retryable: false }` + `WWW-Authenticate: Bearer`
//   (checkout route auth prologue parity, Phase 28/29 precedent).
//
//   GET /api/orders/by-user → HasOrderResult passthrough, NEVER 5xx
//   (routes.py:88 "Nunca retorna erro" at route level too — an exception in
//   getActiveReservation degrades to the NO_ORDER 200 like the Python
//   try/except).
//
//   GET /api/orders/list   → { orders: OrderListItem[] } passthrough, never 500.
//
//   GET /api/orders/[uuid] → kind discrimination (30-01 contract):
//   not_found → 404 ORDER_NOT_FOUND | other-user → 403 ORDER_FORBIDDEN (D-07)
//   | ok + expired → 410 ORDER_EXPIRED (routes.py:188-193) | ok → 200 order
//   passthrough. Malformed uuids 404 BEFORE any query (T-30-03-01 — no
//   existence oracle; getOrderDetailForUser must not be called).
//
// HOW INVOCATION WORKS (vitest + App Router handlers):
//   Handlers are imported directly (no Next server): GET(new NextRequest(url),
//   { params: Promise.resolve({ uuid }) }) — params are ASYNC promises in
//   Next 15/16 (see `/api/payment/pix/[txid]/route.ts`). `@/lib/auth/guards`,
//   `@/lib/orders/queries` and `@/lib/prisma` are replaced with hoisted spies.
//
// NOTE on the numeric user id: UserIdentity (real getCurrentUser) carries only
// `uuid`; the routes resolve the numeric Prisma user id via
// `prisma.user.findUnique({ where: { uuid }, select: { id: true } })` — the
// checkout route precedent (route.ts:95-98). The tests therefore mock the
// identity with a uuid and the prisma lookup to `{ id: 7 }`, then pin that the
// queries receive 7.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { AuthError } from "@/lib/auth/jwt";
import type {
  HasOrderResult,
  OrderDetailOrder,
  OrderListItem,
} from "@/lib/orders/queries";

import { GET as byUserGET } from "./by-user/route";
import { GET as listGET } from "./list/route";
import { GET as detailGET } from "./[uuid]/route";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getActiveReservation: vi.fn(),
  listOrdersByUser: vi.fn(),
  getOrderDetailForUser: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/orders/queries", () => ({
  getActiveReservation: mocks.getActiveReservation,
  listOrdersByUser: mocks.listOrdersByUser,
  getOrderDetailForUser: mocks.getOrderDetailForUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Parity constants + fixtures ────────────────────────────────────────────
const USER_UUID = "48d2c3a1-9b4e-4f6d-a1c2-3d4e5f6a7b8c"; // identity uuid (v4)
const USER_ID = 7;
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c"; // order uuid (v4)
const ORDER_SHORT_ID = `P-${ORDER_UUID.slice(0, 5).toUpperCase()}`; // "P-5B3C2"

const IDENTITY = {
  email: "fulano@example.com",
  scopes: [],
  is_verified: true,
  is_master: false,
  uuid: USER_UUID,
};

const HAS_ORDER: HasOrderResult = {
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

function listItemFixture(overrides: Partial<OrderListItem> = {}): OrderListItem {
  return {
    id: ORDER_UUID,
    short_id: ORDER_SHORT_ID,
    status: "PENDING",
    total: 159.9,
    created_at: new Date("2026-09-16T12:00:00.000Z"),
    items: [{ name: "Baralho Bicycle", qty: 1, price: 134.0, order_item_id: 11 }],
    shipping_carrier: "Correios",
    payment_method: "pix",
    recipient_name: "Fulano de Tal",
    ...overrides,
  };
}

function detailOrderFixture(
  overrides: Partial<OrderDetailOrder> = {},
): OrderDetailOrder {
  return {
    id: ORDER_UUID,
    uuid: ORDER_SHORT_ID,
    status: "PENDING", // additive 30-07 — badge/countdown gate
    payment_status: "PENDING",
    subtotal: 134.0,
    shipping_method: "PAC",
    shipping_carrier: "Correios",
    shipping_cost: 25.9,
    shipping_discount: 0,
    shipping_original: 25.9,
    shipping_delivery_days: 7,
    expires_at: 5400,
    total: 159.9,
    user: { recipient_name: "Fulano de Tal", recipient_document: "12345678909" },
    items: [
      {
        product_id: 101,
        quantity: 1,
        unit_price: 134.0,
        total_price: 134.0,
        img_product: "https://img.example/bicycle.png",
        product_name: "Baralho Bicycle",
      },
    ],
    payment_method: "pix",
    paid_at: null,
    created_at: new Date("2026-09-16T12:00:00.000Z"),
    shipping_full: null,
    tracking: null,
    expired: false,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getCurrentUser.mockReset().mockResolvedValue(IDENTITY);
  mocks.getActiveReservation.mockReset();
  mocks.listOrdersByUser.mockReset();
  mocks.getOrderDetailForUser.mockReset();
  mocks.prisma.user.findUnique
    .mockReset()
    .mockResolvedValue({ id: USER_ID });
});

describe("GET /api/orders/* — auth gate (T-30-03-01)", () => {
  it("GET /api/orders/by-user unauthenticated → 401 D-12", async () => {
    mocks.getCurrentUser.mockReset().mockRejectedValue(
      new AuthError("Não autenticado", 401, "UNAUTHORIZED"),
    );

    const res = await byUserGET(new NextRequest("http://localhost/api/orders/by-user"));

    expect(res.status).toBe(401);
    expect(mocks.getActiveReservation).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: "Não autenticado",
      code: "UNAUTHORIZED",
      retryable: false,
    });
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("GET /api/orders/list unauthenticated → 401 D-12", async () => {
    mocks.getCurrentUser.mockReset().mockRejectedValue(
      new AuthError("Não autenticado", 401, "UNAUTHORIZED"),
    );

    const res = await listGET(new NextRequest("http://localhost/api/orders/list"));

    expect(res.status).toBe(401);
    expect(mocks.listOrdersByUser).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: "Não autenticado",
      code: "UNAUTHORIZED",
      retryable: false,
    });
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("GET /api/orders/[uuid] unauthenticated → 401 D-12", async () => {
    mocks.getCurrentUser.mockReset().mockRejectedValue(
      new AuthError("Não autenticado", 401, "UNAUTHORIZED"),
    );

    const res = await detailGET(
      new NextRequest(`http://localhost/api/orders/${ORDER_UUID}`),
      { params: Promise.resolve({ uuid: ORDER_UUID }) },
    );

    expect(res.status).toBe(401);
    expect(mocks.getOrderDetailForUser).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      error: "Não autenticado",
      code: "UNAUTHORIZED",
      retryable: false,
    });
    expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
  });
});

describe("GET /api/orders/by-user — HasOrderResult gate", () => {
  it("200 with EXACT passthrough of the active-reservation result", async () => {
    mocks.getActiveReservation.mockResolvedValue(HAS_ORDER);

    const res = await byUserGET(new NextRequest("http://localhost/api/orders/by-user"));

    expect(res.status).toBe(200);
    expect(mocks.getActiveReservation).toHaveBeenCalledWith(USER_ID);
    await expect(res.json()).resolves.toEqual(HAS_ORDER);
  });

  it("never 500: query exception degrades to the NO_ORDER 200 (routes.py:88)", async () => {
    mocks.getActiveReservation.mockRejectedValue(new Error("db down"));

    const res = await byUserGET(new NextRequest("http://localhost/api/orders/by-user"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(NO_ORDER);
  });
});

describe("GET /api/orders/list — order history feed", () => {
  it("200 { orders: [...] } passthrough", async () => {
    const orders = [listItemFixture(), listItemFixture({ id: ORDER_UUID, short_id: ORDER_SHORT_ID, total: 89.9 })];
    mocks.listOrdersByUser.mockResolvedValue(orders);

    const res = await listGET(new NextRequest("http://localhost/api/orders/list"));

    expect(res.status).toBe(200);
    expect(mocks.listOrdersByUser).toHaveBeenCalledWith(USER_ID);
    // Wire parity: Date fields serialize to ISO strings (Python datetime
    // serialization parity) — the expected value is the JSON round-trip.
    await expect(res.json()).resolves.toEqual(JSON.parse(JSON.stringify({ orders })));
  });

  it("200 { orders: [] } when the user has no orders", async () => {
    mocks.listOrdersByUser.mockResolvedValue([]);

    const res = await listGET(new NextRequest("http://localhost/api/orders/list"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ orders: [] });
  });

  it("never 500: query exception → 200 { orders: [] }", async () => {
    mocks.listOrdersByUser.mockRejectedValue(new Error("db down"));

    const res = await listGET(new NextRequest("http://localhost/api/orders/list"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ orders: [] });
  });
});

describe("GET /api/orders/[uuid] — kind discrimination (D-07, routes.py:188-193)", () => {
  async function callDetail(uuid: string) {
    return detailGET(new NextRequest(`http://localhost/api/orders/${uuid}`), {
      params: Promise.resolve({ uuid }),
    });
  }

  it("unknown order → 404 ORDER_NOT_FOUND", async () => {
    mocks.getOrderDetailForUser.mockResolvedValue({ kind: "not_found" });

    const res = await callDetail(ORDER_UUID);

    expect(res.status).toBe(404);
    expect(mocks.getOrderDetailForUser).toHaveBeenCalledWith(ORDER_UUID, USER_ID);
    await expect(res.json()).resolves.toEqual({
      error: "Pedido não encontrado",
      code: "ORDER_NOT_FOUND",
      retryable: false,
    });
  });

  it("non-owner order → 403 ORDER_FORBIDDEN (D-07)", async () => {
    mocks.getOrderDetailForUser.mockResolvedValue({ kind: "forbidden" });

    const res = await callDetail(ORDER_UUID);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Sem permissão para ver este pedido",
      code: "ORDER_FORBIDDEN",
      retryable: false,
    });
  });

  it("expired pending reservation → 410 ORDER_EXPIRED (routes.py:188-193)", async () => {
    mocks.getOrderDetailForUser.mockResolvedValue({
      kind: "ok",
      order: detailOrderFixture({ expired: true, expires_at: 0 }),
    });

    const res = await callDetail(ORDER_UUID);

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      error: "O prazo de reserva deste pedido expirou. Inicie um novo checkout.",
      code: "ORDER_EXPIRED",
      retryable: false,
    });
  });

  it("ok + not expired → 200 order passthrough", async () => {
    const order = detailOrderFixture();
    mocks.getOrderDetailForUser.mockResolvedValue({ kind: "ok", order });

    const res = await callDetail(ORDER_UUID);

    expect(res.status).toBe(200);
    // Wire parity: created_at/paid_at serialize to ISO strings.
    await expect(res.json()).resolves.toEqual(JSON.parse(JSON.stringify(order)));
  });

  it.each(["abc", "not-a-uuid"])(
    "malformed uuid %s → 404 ORDER_NOT_FOUND WITHOUT calling the query (no existence oracle, T-30-03-01)",
    async (badUuid) => {
      const res = await callDetail(badUuid);

      expect(res.status).toBe(404);
      expect(mocks.getOrderDetailForUser).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toEqual({
        error: "Pedido não encontrado",
        code: "ORDER_NOT_FOUND",
        retryable: false,
      });
    },
  );
});