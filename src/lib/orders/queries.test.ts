// Order read layer contract tests (Plan 30-01, TDD RED).
//
// Parity targets (30-CONTEXT D-01..D-03/D-07; Python
// `Backend/app/store/orders/routes.py` + `schemas.py`):
//   - listOrdersByUser        → OrderListItemOut shape parity (routes.py:92-147,
//                               created_at DESC, [] never null)
//   - getActiveReservation    → HasOrderDetail; "Nunca retorna erro" (routes.py:20-89).
//                               Message-variant check ORDER MATTERS:
//                               card → pix-paid → pix-unpaid → generic (L58-86).
//                               expires_at = max(0, int((expires - now).total_seconds()))
//                               — Python int() truncation → Math.floor parity.
//   - getOrderDetailForUser   → OrderDetailOut parity + Next additives (payment_method,
//                               paid_at, created_at, shipping_full, tracking, expired) —
//                               404 unknown vs 403 non-owner discrimination (D-07),
//                               410-expired parity (routes.py:188-193).
//
// NOTE: the Prisma client exposes the schema's snake_case field names
// (efipay_charge_card_id, reservation_expires_at, product_name,
// melhorenvio_status_label, ...) — the fixture rows mirror that. Prisma enums
// come back UPPERCASE ("PENDING", "PAID"...) and are NEVER translated to the
// Python lowercase strings (30-01 <interfaces> block) — the tests pin the
// Prisma enum values the routes/pages compare against.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    order: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Fixed time + fixtures (the ONLY Order fields the read layer consumes) ─

const NOW = new Date("2026-09-16T12:00:00.000Z");
const USER_ID = 7;
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c";
const SHORT_ID = `P-${ORDER_UUID.slice(0, 5).toUpperCase()}`; // "P-5B3C2"
const RESERVATION_EXPIRES_AT = new Date(NOW.getTime() + 90 * 60_000); // NOW + 90 min
const EXPIRES_AT_SECONDS = 5400; // (90 * 60 * 1000) / 1000, Python int() parity
const RESERVATION_ISO = RESERVATION_EXPIRES_AT.toISOString();
const OTHER_USER_ID = 99;

const NO_ORDER = {
  success: false,
  message: "",
  redirect: null,
  expires_at: 0,
  expires_at_iso: null,
};

const CARD_MESSAGE = `Pedido aguardando pagamento ou já pago, aguarde o tempo para realizar outra compra! Pedido Nº #${SHORT_ID}`;
const PIX_PAID_MESSAGE = `Pedido pago via PIX, aguarde o tempo para realizar outra compra! Pedido Nº #${SHORT_ID}`;
const PIX_UNPAID_MESSAGE = `Pedido aguardando pagamento. Se já realizou o pagamento, ignore e aguarde. Pedido Nº #${SHORT_ID}`;
const GENERIC_MESSAGE = `Pedido Nº #${SHORT_ID} — finalize o pagamento ou aguarde o tempo para realizar outra compra!`;

function shippingFixture() {
  return {
    id: 3,
    order_id: 1,
    recipient_name: "Fulano de Tal",
    recipient_document: "12345678909",
    recipient_phone: "(11) 99999-9999",
    recipient_email: "fulano@example.com",
    street: "Rua das Flores",
    number: "123",
    complement: null,
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    postal_code: "01310100",
    created_at: NOW,
    updated_at: NOW,
  };
}

function itemFixture(id = 11) {
  return {
    id,
    order_id: 1,
    product_id: 101,
    product_name: "Baralho Bicycle",
    img_product: "https://img.example/bicycle.png",
    quantity: 1,
    unit_price: 134.0,
    total_price: 134.0,
  };
}

function shipmentFixture(overrides = {}) {
  return {
    id: 5,
    order_id: 1,
    melhorenvio_cart_id: null,
    melhorenvio_order_id: null,
    tracking_code: "BR123456789",
    tracking_url: "https://www.melhorrastreio.com.br/BR123456789",
    label_url: null,
    shipping_company: "Correios",
    shipping_service: "PAC",
    shipping_status: "delivered",
    posted_at: NOW,
    delivered_at: NOW,
    estimated_delivery_at: null,
    is_reverse: null,
    reverse_order_id: null,
    shipping_cost: 25.9,
    weight: 0.5,
    height: 5,
    width: 15,
    length: 20,
    created_at: NOW,
    updated_at: NOW,
    // status_history is ordered created_at DESC by the real query — index 0
    // is the LATEST event (the mock does not reorder, so fixtures mimic it).
    status_history: [
      {
        id: 9,
        order_id: 1,
        shipment_id: 5,
        melhorenvio_status: "delivered",
        melhorenvio_status_label: "Entregue",
        message: null,
        location: "São Paulo/SP",
        raw_payload: null,
        created_at: new Date(NOW.getTime() - 60_000),
      },
      {
        id: 8,
        order_id: 1,
        shipment_id: 5,
        melhorenvio_status: "posted",
        melhorenvio_status_label: "Postado",
        message: null,
        location: null,
        raw_payload: null,
        created_at: new Date(NOW.getTime() - 120_000),
      },
    ],
    ...overrides,
  };
}

function orderRowFixture(overrides = {}) {
  return {
    id: 1,
    uuid: ORDER_UUID,
    user_id: USER_ID,
    status: "PENDING",
    payment_status: "PENDING",
    efipay_charge_pix_id: null,
    efipay_charge_card_id: null,
    paid_at: null,
    payment_method: null,
    reservation_expires_at: RESERVATION_EXPIRES_AT,
    shipping_carrier: "Correios",
    shipping_method: "PAC",
    shipping_cost: 25.9,
    shipping_discount: 0,
    shipping_original: 25.9,
    shipping_delivery_days: 7,
    subtotal: 134.0,
    total: 159.9,
    created_at: NOW,
    updated_at: NOW,
    items: [itemFixture()],
    shipping: shippingFixture(),
    shipments: [], // no tracking data by default — tests opt in
    ...overrides,
  };
}

// Expected OrderDetailOut-parity + additive shape for the owned happy path.
// `order` overrides deep-merge into the base order (e.g. { expires_at: 0 }).
function expectedDetailOrder(orderOverrides = {}) {
  return {
    kind: "ok",
    order: {
      id: ORDER_UUID,
      uuid: SHORT_ID,
      status: "PENDING", // additive 30-07 — badge/countdown gate
      payment_status: "PENDING",
      subtotal: 134.0,
      shipping_method: "PAC",
      shipping_carrier: "Correios",
      shipping_cost: 25.9,
      shipping_discount: 0, // 0 fallback when null
      shipping_original: 25.9,
      shipping_delivery_days: 7,
      expires_at: EXPIRES_AT_SECONDS,
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
      // ── Next additives (30-01 behavior contract) ──
      payment_method: null,
      paid_at: null,
      created_at: NOW,
      shipping_full: {
        recipient_name: "Fulano de Tal",
        recipient_document: "12345678909",
        recipient_phone: "(11) 99999-9999",
        recipient_email: "fulano@example.com",
        street: "Rua das Flores",
        number: "123",
        complement: null,
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        postal_code: "01310100",
      },
      tracking: {
        tracking_code: "BR123456789",
        tracking_url: "https://www.melhorrastreio.com.br/BR123456789",
        shipping_company: "Correios",
        shipping_status: "delivered",
        status_label: "Entregue", // latest ShippingStatusHistory label
        status_updated_at: new Date(NOW.getTime() - 60_000), // latest history created_at
      },
      expired: false,
      ...orderOverrides,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  vi.resetModules();
  // Default DB stubs — tests override per scenario.
  mocks.prisma.order.findMany.mockResolvedValue([]);
  mocks.prisma.order.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

// ─── listOrdersByUser ───────────────────────────────────────────────────────

describe("listOrdersByUser() — OrderListItemOut parity (routes.py:92-147)", () => {
  it("maps each order to the SPA-parity item shape and queries created_at DESC", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      orderRowFixture({ payment_method: "PIX" }),
    ]);
    const { listOrdersByUser } = await import("./queries");

    const result = await listOrdersByUser(USER_ID);

    expect(mocks.prisma.order.findMany).toHaveBeenCalledWith({
      where: { user_id: USER_ID },
      include: { items: true, shipping: true },
      orderBy: { created_at: "desc" }, // routes.py:116 parity
    });
    expect(result).toEqual([
      {
        id: ORDER_UUID,
        short_id: SHORT_ID,
        status: "PENDING",
        total: 159.9,
        created_at: NOW,
        items: [{ name: "Baralho Bicycle", qty: 1, price: 134.0, order_item_id: 11 }],
        shipping_carrier: "Correios",
        payment_method: "PIX",
        recipient_name: "Fulano de Tal",
      },
    ]);
  });

  it("maps recipient_name to null when the order has no shipping row", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([
      orderRowFixture({ shipping: null }),
    ]);
    const { listOrdersByUser } = await import("./queries");

    const result = await listOrdersByUser(USER_ID);

    expect(result).toHaveLength(1);
    expect(result[0].recipient_name).toBeNull();
  });

  it("returns [] (never null) for an empty order list", async () => {
    mocks.prisma.order.findMany.mockResolvedValue([]);
    const { listOrdersByUser } = await import("./queries");

    const result = await listOrdersByUser(USER_ID);

    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });
});

// ─── getActiveReservation ───────────────────────────────────────────────────

describe("getActiveReservation() — HasOrderDetail parity, never errors (routes.py:20-89)", () => {
  it("returns NO_ORDER when no order has an open reservation window", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(null);
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(mocks.prisma.order.findFirst).toHaveBeenCalledWith({
      where: { user_id: USER_ID, reservation_expires_at: { gt: expect.any(Date) } },
    });
    expect(result).toEqual(NO_ORDER);
  });

  it("swallows any DB exception and still returns NO_ORDER (Nunca retorna erro)", async () => {
    mocks.prisma.order.findFirst.mockRejectedValue(new Error("db indisponível"));
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual(NO_ORDER);
  });

  it("classifies a card charge FIRST (card wins over a paid pix — check order matters)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({
        efipay_charge_card_id: "charge_card_1",
        efipay_charge_pix_id: "txid-1",
        payment_status: "PAID",
      }),
    );
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual({
      success: true,
      message: CARD_MESSAGE,
      redirect: "/",
      expires_at: EXPIRES_AT_SECONDS,
      expires_at_iso: RESERVATION_ISO,
    });
  });

  it("classifies a PIX charge paid via payment_status PAID", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({ efipay_charge_pix_id: "txid-1", payment_status: "PAID" }),
    );
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual({
      success: true,
      message: PIX_PAID_MESSAGE,
      redirect: "/",
      expires_at: EXPIRES_AT_SECONDS,
      expires_at_iso: RESERVATION_ISO,
    });
  });

  it("classifies a PIX charge paid via paid_at (routes.py:67 parity)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({ efipay_charge_pix_id: "txid-1", paid_at: NOW }),
    );
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual({
      success: true,
      message: PIX_PAID_MESSAGE,
      redirect: "/",
      expires_at: EXPIRES_AT_SECONDS,
      expires_at_iso: RESERVATION_ISO,
    });
  });

  it("classifies an UNPAID pix charge with the resume-payment redirect", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({ efipay_charge_pix_id: "txid-1" }),
    );
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual({
      success: true,
      message: PIX_UNPAID_MESSAGE,
      redirect: `/checkout/${ORDER_UUID}`,
      expires_at: EXPIRES_AT_SECONDS,
      expires_at_iso: RESERVATION_ISO,
    });
  });

  it("classifies an order with no charge at all as the generic finalize-payment variant", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderRowFixture());
    const { getActiveReservation } = await import("./queries");

    const result = await getActiveReservation(USER_ID);

    expect(result).toEqual({
      success: true,
      message: GENERIC_MESSAGE,
      redirect: `/checkout/${ORDER_UUID}`,
      expires_at: EXPIRES_AT_SECONDS,
      expires_at_iso: RESERVATION_ISO,
    });
  });
});

// ─── getOrderDetailForUser ──────────────────────────────────────────────────

describe("getOrderDetailForUser() — owner-scoped detail (D-07, routes.py:150-236)", () => {
  it("returns not_found for an unknown uuid — never throws", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(null);
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser("4a1b2c3d-0000-0000-0000-000000000000", USER_ID);

    expect(mocks.prisma.order.findFirst).toHaveBeenCalledWith({
      where: { uuid: "4a1b2c3d-0000-0000-0000-000000000000" },
      include: {
        items: true,
        shipping: true,
        shipments: { include: { status_history: { orderBy: { created_at: "desc" } } } },
      },
    });
    expect(result).toEqual({ kind: "not_found" });
  });

  it("returns forbidden (403 distinct from unknown 404) for another user's order", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({ user_id: OTHER_USER_ID }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual({ kind: "forbidden" });
  });

  it("maps an owned order to OrderDetailOut parity + All Next additives + tracking block", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({
        shipments: [shipmentFixture()],
        payment_method: "PIX",
        paid_at: NOW,
      }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(
      expectedDetailOrder({ payment_method: "PIX", paid_at: NOW }),
    );
  });

  it("computes expired=true when the reservation is past AND status is PENDING (410 parity)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({
        reservation_expires_at: new Date(NOW.getTime() - 60_000),
        status: "PENDING",
      }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(
      expectedDetailOrder({ expires_at: 0, expired: true, tracking: null }),
    );
  });

  it("never marks paid/confirmed orders expired even past the reservation (routes.py:189)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({
        reservation_expires_at: new Date(NOW.getTime() - 60_000),
        status: "CONFIRMED",
      }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(
      expectedDetailOrder({
        status: "CONFIRMED",
        expires_at: 0,
        expired: false,
        tracking: null,
      }),
    );
  });

  it("returns expires_at null when the order has no reservation window", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({ reservation_expires_at: null }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(
      expectedDetailOrder({ expires_at: null, expired: false, tracking: null }),
    );
  });

  it("returns tracking null when there are no shipments (D-04 render gating)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderRowFixture({ shipments: [] }));
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(expectedDetailOrder({ tracking: null }));
  });

  it("returns tracking null when the shipment has NO tracking_code/url (D-04)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(
      orderRowFixture({
        shipments: [shipmentFixture({ tracking_code: null, tracking_url: null })],
      }),
    );
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(expectedDetailOrder({ tracking: null }));
  });

  it("maps user + shipping_full to null when the order has no shipping row", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderRowFixture({ shipping: null }));
    const { getOrderDetailForUser } = await import("./queries");

    const result = await getOrderDetailForUser(ORDER_UUID, USER_ID);

    expect(result).toEqual(
      expectedDetailOrder({ user: null, shipping_full: null, tracking: null }),
    );
  });
});