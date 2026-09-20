// Card refund engine contract tests (Plan 30-02, TDD RED).
//
// Parity targets (30-CONTEXT D-05/D-07/D-13; Python
// `Backend/app/payment/routes.py` L158-192 + `service.py` refund_card_charge
// L631-667 + get_card_charge_details; `card-flow.md` L262 refund terminal
// state machine):
//
//   TRANSPORT (REAL efi-client module — eslint/tsc names via __efiClientReal
//   handle, node:https + ../../../lib/efi-cert mocked per 29-01
//   efi-client.test.ts pattern):
//   - getCardChargeDetails: GET /v1/charge/{id} on the cobrancas family;
//     normalization of the REAL Efí detail shape — status as OBJECT
//     { current: "paid" } (the upstream Python bug: `.get("status") != "paid"`
//     always rejected object statuses) → "paid"; scalar "paid" → "paid";
//     ARRAY data → first element wins; non-numeric chargeId → EFI_INVALID_REQUEST
//     BEFORE any network (Python int(charge_id) parity, fail-closed); unknown
//     status → "unknown" (caller maps to rejection).
//   - refundCardCharge: POST /v1/charge/card/{id}/refund — body OMITTED on
//     full refund (service.py:631-645 `body or None` parity — never
//     amount: null/0), { amount: cents } on partial; amount <= 0 →
//     EFI_INVALID_REQUEST "Amount deve ser positivo em centavos" with NO call;
//     result.code 200/201 → { status: "success", message, response };
//     outside 200/201 → EFI_INVALID_REQUEST PT-BR (service.py:647-651 parity,
//     T-25-03 — raw bodies/charge ids never interpolated wholesale).
//
//   TRANSITION (requestCardRefund — mocked efi-client + prisma):
//   - Guard chain with distinct D-07 codes and NO Efí traffic on
//     non-actionable requests: unknown order → REFUND_NOT_FOUND; non-owner →
//     REFUND_FORBIDDEN; no efipay_charge_card_id → REFUND_NO_CHARGE;
//     already REFUNDED → REFUND_ALREADY_DONE (D-09 fail-closed idempotency).
//   - D-13 liveness BEFORE any DB write: live status must be "paid" else
//     REFUND_INVALID_STATUS; EfiError propagates as-is.
//   - Efí refund OUTSIDE the $transaction (no network under row locks);
//     a failed refund call never starts the tx (funds-safe ordering).
//   - Single interactive tx: FOR UPDATE re-lock of the order row + in-tx
//     re-check (race guard — one transition ever), grouped stock release
//     per product_id by sum(quantity) with Math.max(0, ...) clamp (never
//     negative reserved_stock), terminal state payment_status REFUNDED +
//     status CANCELED (card-flow.md:262 webhook parity).

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as EfiClientModule from "@/lib/payments/efi-client";
import type { EfiError } from "@/lib/payments/types";

const mocks = vi.hoisted(() => ({
  httpsRequestSpy: vi.fn(),
  getEfiAgentSpy: vi.fn(),
  getEfiSandboxConfigSpy: vi.fn(),
  getCardChargeDetailsSpy: vi.fn(),
  refundCardChargeSpy: vi.fn(),
  prisma: {
    order: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// node:https is CJS — vitest's interop requires a `default` export on the mock.
vi.mock("node:https", () => ({
  request: mocks.httpsRequestSpy,
  default: { request: mocks.httpsRequestSpy },
}));

vi.mock("../../../lib/efi-cert", () => ({
  getEfiAgent: mocks.getEfiAgentSpy,
  getEfiSandboxConfig: mocks.getEfiSandboxConfigSpy,
}));

// The TRANSITION tests need the efi-client module MOCKED (spies on
// getCardChargeDetails/refundCardCharge — the exact card.test.ts pattern).
// The TRANSPORT tests need the REAL implementations: they load the module
// through a UNIQUE query-suffixed specifier (realEfi below) — that id does
// not match this mock, and each evaluation is a fresh module instance (fresh
// OAuth tokenCache), keeping the stubbed https FIFO aligned test-to-test.
vi.mock("@/lib/payments/efi-client", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/payments/efi-client")>();
  return {
    ...mod,
    getCardChargeDetails: mocks.getCardChargeDetailsSpy,
    refundCardCharge: mocks.refundCardChargeSpy,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Parity constants ──────────────────────────────────────────────────────
const PIX_SANDBOX_BASE = "https://pix-h.api.efipay.com.br";
const CHARGES_SANDBOX_BASE = "https://cobrancas-h.api.efipay.com.br";
const SANDBOX_HEADERS = { "x-skip-mtls-checking": "true" };
const TEST_CLIENT_ID = "test-client-id";
const TEST_CLIENT_SECRET = "test-client-secret";

// ─── Transition fixtures (the ONLY Order/Product fields the transition reads)
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c";
const USER_ID = 7;
const CHARGE_ID = "charge_efi_12345";

function orderFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    uuid: ORDER_UUID,
    user_id: USER_ID,
    efipay_charge_card_id: CHARGE_ID,
    payment_status: "PAID",
    status: "CONFIRMED",
    total: 159.9,
    ...overrides,
  };
}

// ─── Fake interactive-transaction client (executor mock per plan) ──────────
type TxMock = {
  $queryRaw: ReturnType<typeof vi.fn>;
  orderItem: { groupBy: ReturnType<typeof vi.fn> };
  product: { update: ReturnType<typeof vi.fn> };
  order: { update: ReturnType<typeof vi.fn> };
};

function makeTx(): TxMock {
  return {
    $queryRaw: vi.fn(),
    orderItem: { groupBy: vi.fn() },
    product: { update: vi.fn() },
    order: { update: vi.fn() },
  };
}

let tx: TxMock;

// ─── https.request stub infra (29-01 efi-client.test.ts pattern) ───────────
type StubResponse = { status: number; body: unknown };
type RequestCall = [
  url: string,
  options: { method?: string; headers: Record<string, string | undefined>; agent?: unknown },
];

let capturedBodies: string[] = [];

/** FIFO stub for https.request: each call consumes exactly one queued response. */
function stubResponses(queue: StubResponse[]) {
  for (let i = 0; i < queue.length; i++) {
    mocks.httpsRequestSpy.mockImplementationOnce(
      (_url: unknown, _options: unknown, cb: (res: unknown) => void) => {
        const next = queue[i];
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = next.status;
        cb(res);
        queueMicrotask(() =>
          res.emit("data", typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
        );
        queueMicrotask(() => res.emit("end"));
        return {
          on: vi.fn(),
          write: vi.fn((chunk: string) => {
            capturedBodies.push(String(chunk));
          }),
          end: vi.fn(),
          setTimeout: vi.fn(),
        };
      },
    );
  }
}

function requestCalls(): RequestCall[] {
  return mocks.httpsRequestSpy.mock.calls as unknown as RequestCall[];
}

function expectEfiError(err: unknown, code: string, retryable: boolean) {
  expect(err).toBeTruthy();
  const e = err as EfiError;
  expect(e.code).toBe(code);
  expect(e.retryable).toBe(retryable);
  expect(typeof e.error).toBe("string");
  expect(e.error.length).toBeGreaterThan(0);
}

/**
 * The REAL efi-client module (transport) — escapes the transition mock.
 *
 * vitest caches the importOriginal() result of the mock factory for the whole
 * FILE, so the mocked handle would SHARE the real module's OAuth tokenCache —
 * test 1 populates it and every later transport test would skip the OAuth
 * https call, shifting the stub FIFO off by one. A unique `?real=<n>` query
 * specifier is a distinct module id (not matched by the mock above): each call
 * evaluates a FRESH instance with an EMPTY tokenCache, so the two-call
 * OAuth→charge/refund queue always aligns.
 */
let realSeq = 0;
async function realEfi() {
  const spec = `./efi-client?real=${++realSeq}`;
  const mod = await import(/* @vite-ignore */ spec);
  return mod as typeof EfiClientModule;
}

async function loadRefund() {
  return await import("./refund");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  capturedBodies = [];
  tx = makeTx();
  process.env.EFI_SANDBOX = "true";
  process.env.EFI_CLIENT_ID = TEST_CLIENT_ID;
  process.env.EFI_CLIENT_SECRET = TEST_CLIENT_SECRET;
  mocks.getEfiAgentSpy.mockImplementation(() => ({ hostname: "x" }));
  mocks.getEfiSandboxConfigSpy.mockImplementation(() => ({
    sandbox: true,
    baseUrl: PIX_SANDBOX_BASE,
    extraHeaders: SANDBOX_HEADERS,
  }));
  mocks.httpsRequestSpy.mockImplementation(() => {
    throw new Error("https.request called with no stubbed response");
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.EFI_SANDBOX;
  delete process.env.EFI_CLIENT_ID;
  delete process.env.EFI_CLIENT_SECRET;
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — getCardChargeDetails (REAL module, https stubbed)
// ═══════════════════════════════════════════════════════════════════════════

describe("getCardChargeDetails — TRANSPORT (real module, https stubbed)", () => {
  it("GETs /v1/charge/{chargeId} on the cobrancas family host with Bearer auth", async () => {
    stubResponses([
      { status: 200, body: { access_token: "tok-refund", expires_in: 3600 } },
      { status: 200, body: { data: { status: "paid" } } },
    ]);
    const real = await realEfi();

    // Real Efí charge ids are numeric strings (Phase 29 `identifiers.charge_id`),
    // so the fail-closed int() gate is exercised with a numeric id here and
    // separately with a junk value in the non-numeric rejection test below.
    const result = await real.getCardChargeDetails("123456");

    expect(result).toEqual({ status: "paid" });
    expect(mocks.httpsRequestSpy).toHaveBeenCalledTimes(2);
    const [url, options] = requestCalls()[1];
    expect(url).toBe(`${CHARGES_SANDBOX_BASE}/v1/charge/123456`);
    expect(options.method).toBe("GET");
    expect(options.headers.Authorization).toBe("Bearer tok-refund");
    // D-15 — sandbox bypass header forwarded from getEfiSandboxConfig().extraHeaders
    expect(options.headers["x-skip-mtls-checking"]).toBe("true");
    // GET carries no body — only the OAuth form body was written
    expect(capturedBodies).toHaveLength(1);
  });

  it("normalizes the REAL Efí detail shape — status OBJECT { current: \"paid\" } → \"paid\" (upstream-bug fix)", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { data: { status: { current: "paid" } } } },
    ]);
    const real = await realEfi();

    expect(await real.getCardChargeDetails("123456")).toEqual({ status: "paid" });
  });

  it("accepts a SCALAR status \"paid\" too (defensive)", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { data: { status: "paid" } } },
    ]);
    const real = await realEfi();

    expect(await real.getCardChargeDetails("123456")).toEqual({ status: "paid" });
  });

  it("resolves status from data ARRAY first element (first element wins)", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      {
        status: 200,
        body: { data: [{ status: { current: "waiting" } }, { status: { current: "paid" } }] },
      },
    ]);
    const real = await realEfi();

    expect(await real.getCardChargeDetails("123456")).toEqual({ status: "waiting" });
  });

  it("rejects a non-numeric chargeId with EFI_INVALID_REQUEST BEFORE any network (Python int() parity, fail-closed)", async () => {
    const real = await realEfi();

    const err = await real.getCardChargeDetails("not-a-number").catch((e: unknown) => e);

    expectEfiError(err, "EFI_INVALID_REQUEST", false);
    expect(mocks.httpsRequestSpy).not.toHaveBeenCalled();
  });

  it("returns \"unknown\" for an unexpected/missing status — caller maps to rejection", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { data: { status: { current: 42 } } } },
    ]);
    const real = await realEfi();

    expect(await real.getCardChargeDetails("123456")).toEqual({ status: "unknown" });
  });

  it("returns \"unknown\" when the payload has no status field at all", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { data: { charge: { id: 1 } } } },
    ]);
    const real = await realEfi();

    expect(await real.getCardChargeDetails("123456")).toEqual({ status: "unknown" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSPORT — refundCardCharge (REAL module, https stubbed)
// ═══════════════════════════════════════════════════════════════════════════

describe("refundCardCharge — TRANSPORT (real module, https stubbed)", () => {
  it("POSTs /v1/charge/card/{chargeId}/refund with NO body on full refund (service.py `body or None` parity)", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { code: 200, message: "Estorno solicitado com sucesso" } },
    ]);
    const real = await realEfi();

    const result = await real.refundCardCharge(CHARGE_ID);

    expect(result.status).toBe("success");
    expect(result.message).toBe("Estorno solicitado com sucesso");
    expect(result.response).toEqual({ code: 200, message: "Estorno solicitado com sucesso" });
    expect(mocks.httpsRequestSpy).toHaveBeenCalledTimes(2);
    const [url, options] = requestCalls()[1];
    expect(url).toBe(`${CHARGES_SANDBOX_BASE}/v1/charge/card/${CHARGE_ID}/refund`);
    expect(options.method).toBe("POST");
    // OAuth body only — the refund body is OMITTED (never amount: null/0)
    expect(capturedBodies).toHaveLength(1);
  });

  it("sends { amount } in the body on a PARTIAL refund", async () => {
    stubResponses([
      { status: 200, body: { access_token: "t", expires_in: 3600 } },
      { status: 200, body: { code: 200 } },
    ]);
    const real = await realEfi();

    await real.refundCardCharge(CHARGE_ID, 5000);

    expect(JSON.parse(capturedBodies[1])).toEqual({ amount: 5000 });
  });

  it.each([200, 201])(
    "accepts Efí result code %s → success with default message (service.py:653-657 parity)",
    async (code) => {
      stubResponses([
        { status: 200, body: { access_token: "t", expires_in: 3600 } },
        { status: 200, body: { code } },
      ]);
      const real = await realEfi();

      const result = await real.refundCardCharge(CHARGE_ID);

      expect(result).toEqual({
        status: "success",
        message: "Estorno solicitado com sucesso",
        response: { code },
      });
    },
  );

  it.each([
    { body: { code: 400, error_description: "Saldo insuficiente" }, reason: "Saldo insuficiente" },
    { body: { code: 400, mensagem: "Pagamento recusado" }, reason: "Pagamento recusado" },
    { body: { code: 500 }, reason: "Erro desconhecido" },
  ])(
    "rejects result code outside 200/201 with PT-BR EFI_INVALID_REQUEST (reason: $reason)",
    async ({ body, reason }) => {
      stubResponses([
        { status: 200, body: { access_token: "t", expires_in: 3600 } },
        { status: 200, body },
      ]);
      const real = await realEfi();

      const err = await real.refundCardCharge(CHARGE_ID).catch((e: unknown) => e);

      expectEfiError(err, "EFI_INVALID_REQUEST", false);
      expect((err as EfiError).error).toBe(`Falha no estorno: ${reason}`);
      // T-25-03 — the raw charge id is never interpolated into the error
      expect((err as EfiError).error).not.toContain(CHARGE_ID);
    },
  );

  it.each([0, -150])(
    "rejects amount %s with EFI_INVALID_REQUEST BEFORE any network call",
    async (amount) => {
      const real = await realEfi();

      const err = await real.refundCardCharge(CHARGE_ID, amount).catch((e: unknown) => e);

      expectEfiError(err, "EFI_INVALID_REQUEST", false);
      expect((err as EfiError).error).toBe("Amount deve ser positivo em centavos");
      expect(mocks.httpsRequestSpy).not.toHaveBeenCalled();
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSITION — requestCardRefund (mocked efi-client + prisma)
// ═══════════════════════════════════════════════════════════════════════════

describe("requestCardRefund — TRANSITION (mocked efi-client + prisma)", () => {
  it("rejects an unknown order uuid with REFUND_NOT_FOUND — NO Efí call", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(null);
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      error: "Pedido não encontrado",
      code: "REFUND_NOT_FOUND",
      retryable: false,
    });
    expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with REFUND_FORBIDDEN (D-07 403) — NO Efí call", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture({ user_id: 99 }));
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      error: "Sem permissão",
      code: "REFUND_FORBIDDEN",
      retryable: false,
    });
    expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
  });

  it("rejects an order without efipay_charge_card_id with REFUND_NO_CHARGE (routes.py:170) — NO Efí call", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture({ efipay_charge_card_id: null }));
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      error: "Pedido sem cobrança de cartão",
      code: "REFUND_NO_CHARGE",
      retryable: false,
    });
    expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
  });

  it("rejects an already-REFUNDED order with REFUND_ALREADY_DONE BEFORE any Efí call (D-09 fail-closed idempotency)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture({ payment_status: "REFUNDED" }));
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      error: "Estorno já realizado",
      code: "REFUND_ALREADY_DONE",
      retryable: false,
    });
    expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
  });

  it("rejects a live status !== \"paid\" with REFUND_INVALID_STATUS (routes.py:175-177 parity) — refundCardCharge NOT called", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "waiting" });
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      error: "Status inválido para estorno: waiting",
      code: "REFUND_INVALID_STATUS",
      retryable: false,
    });
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([0, -5, 1.5])(
    "rejects amount %s with REFUND_AMOUNT_INVALID — NO Efí call",
    async (amount) => {
      mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
      const { requestCardRefund } = await loadRefund();

      await expect(
        requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID, amount }),
      ).rejects.toMatchObject({
        error: "Amount deve ser positivo em centavos",
        code: "REFUND_AMOUNT_INVALID",
        retryable: false,
      });
      expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
      expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
    },
  );

  it("rejects a partial amount above the order total cents with REFUND_AMOUNT_INVALID — NO Efí call", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture({ total: 159.9 })); // cap 15990
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID, amount: 15991 }),
    ).rejects.toMatchObject({
      error: "Valor do estorno excede o total do pedido",
      code: "REFUND_AMOUNT_INVALID",
      retryable: false,
    });
    expect(mocks.getCardChargeDetailsSpy).not.toHaveBeenCalled();
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
  });

  it("SUCCESS full refund — liveness → one Efí refund (amount undefined) → locked transition releases stock + terminal CANCELED/REFUNDED", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "paid" });
    mocks.refundCardChargeSpy.mockResolvedValue({
      status: "success",
      message: "Estorno solicitado com sucesso",
      response: { code: 200 },
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 7, payment_status: "PAID" }])
      .mockResolvedValueOnce([
        { id: 101, stock: 10, reserved_stock: 2 },
        { id: 102, stock: 5, reserved_stock: 1 },
      ]);
    tx.orderItem.groupBy.mockResolvedValue([
      { product_id: 101, _sum: { quantity: 3 } },
      { product_id: 102, _sum: { quantity: 1 } },
    ]);
    tx.product.update.mockResolvedValue({ id: 101, reserved_stock: 0 });
    tx.order.update.mockResolvedValue({ id: 7, payment_status: "REFUNDED", status: "CANCELED" });
    const { requestCardRefund } = await loadRefund();

    const result = await requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID });

    expect(result).toEqual({
      status: "success",
      message: "Estorno solicitado com sucesso",
      response: { code: 200 },
    });
    // liveness first, then exactly ONE Efí refund call with amount undefined (full)
    expect(mocks.getCardChargeDetailsSpy).toHaveBeenCalledTimes(1);
    expect(mocks.getCardChargeDetailsSpy).toHaveBeenCalledWith(CHARGE_ID);
    expect(mocks.refundCardChargeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.refundCardChargeSpy).toHaveBeenCalledWith(CHARGE_ID, undefined);
    // guard query + re-lock
    expect(mocks.prisma.order.findFirst).toHaveBeenCalledWith({ where: { uuid: ORDER_UUID } });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2); // order lock + products lock
    // grouped stock release per product_id by sum(quantity)
    expect(tx.orderItem.groupBy).toHaveBeenCalledWith({
      by: ["product_id"],
      where: { order_id: 7 },
      _sum: { quantity: true },
    });
    expect(tx.product.update).toHaveBeenCalledTimes(2);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { reserved_stock: 0 },
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { reserved_stock: 0 },
    });
    // terminal state per card-flow.md:262 webhook parity
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        payment_status: "REFUNDED",
        status: "CANCELED",
        updated_at: expect.any(Date),
      },
    });
  });

  it("SUCCESS partial refund — amount passes through to refundCardCharge bound-checked", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "paid" });
    mocks.refundCardChargeSpy.mockResolvedValue({
      status: "success",
      message: "Estorno solicitado com sucesso",
      response: { code: 200 },
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 7, payment_status: "PAID" }])
      .mockResolvedValueOnce([{ id: 101, stock: 10, reserved_stock: 2 }]);
    tx.orderItem.groupBy.mockResolvedValue([{ product_id: 101, _sum: { quantity: 3 } }]);
    tx.product.update.mockResolvedValue({ id: 101, reserved_stock: 0 });
    tx.order.update.mockResolvedValue({ id: 7, payment_status: "REFUNDED", status: "CANCELED" });
    const { requestCardRefund } = await loadRefund();

    const result = await requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID, amount: 5000 });

    expect(result.status).toBe("success");
    expect(mocks.refundCardChargeSpy).toHaveBeenCalledTimes(1);
    expect(mocks.refundCardChargeSpy).toHaveBeenCalledWith(CHARGE_ID, 5000);
    expect(tx.order.update).toHaveBeenCalledTimes(1);
  });

  it("RACE guard — liveness \"paid\" but webhook re-delivery flipped REFUNDED inside the tx → aborts, ONE Efí refund, NO stock change", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "paid" });
    mocks.refundCardChargeSpy.mockResolvedValue({
      status: "success",
      message: "Estorno solicitado com sucesso",
      response: { code: 200 },
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
    // In-tx re-check finds the order ALREADY REFUNDED (lock re-fetch)
    tx.$queryRaw.mockResolvedValueOnce([{ id: 7, payment_status: "REFUNDED" }]);
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({
      code: "REFUND_ALREADY_DONE",
      retryable: false,
    });
    // the transition happened exactly once: one Efí refund, zero DB writes
    expect(mocks.refundCardChargeSpy).toHaveBeenCalledTimes(1);
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it("stock release never goes below zero — Math.max(0, reserved_stock - qty) defensive clamp", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "paid" });
    mocks.refundCardChargeSpy.mockResolvedValue({
      status: "success",
      message: "Estorno solicitado com sucesso",
      response: { code: 200 },
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: TxMock) => unknown) => cb(tx));
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: 7, payment_status: "PAID" }])
      .mockResolvedValueOnce([
        { id: 101, stock: 10, reserved_stock: 1 },
        { id: 102, stock: 5, reserved_stock: 5 },
      ]);
    tx.orderItem.groupBy.mockResolvedValue([
      { product_id: 101, _sum: { quantity: 5 } }, // 1 - 5 would be -4 → clamped to 0
      { product_id: 102, _sum: { quantity: 3 } }, // 5 - 3 = 2 → untouched path
    ]);
    tx.order.update.mockResolvedValue({ id: 7, payment_status: "REFUNDED", status: "CANCELED" });
    const { requestCardRefund } = await loadRefund();

    await requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID });

    expect(tx.product.update).toHaveBeenCalledTimes(2);
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { reserved_stock: 0 },
    });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 102 },
      data: { reserved_stock: 2 },
    });
  });

  it("Efí unreachable during liveness → propagates EfiError (retryable), $transaction NEVER starts", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockRejectedValue({
      error: "Efí indisponível",
      code: "EFI_UNREACHABLE",
      retryable: true,
    });
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "EFI_UNREACHABLE", retryable: true });
    expect(mocks.refundCardChargeSpy).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("Efí refund call fails → propagates EfiError, $transaction NEVER runs (funds-safe ordering)", async () => {
    mocks.prisma.order.findFirst.mockResolvedValue(orderFixture());
    mocks.getCardChargeDetailsSpy.mockResolvedValue({ status: "paid" });
    mocks.refundCardChargeSpy.mockRejectedValue({
      error: "Falha no estorno: Saldo insuficiente",
      code: "EFI_INVALID_REQUEST",
      retryable: false,
    });
    const { requestCardRefund } = await loadRefund();

    await expect(
      requestCardRefund({ orderUuid: ORDER_UUID, userId: USER_ID }),
    ).rejects.toMatchObject({ code: "EFI_INVALID_REQUEST", retryable: false });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});