// Webhook receivers + shared idempotent confirmation contract tests (Plan 29-04, TDD RED).
//
// Parity targets (29-CONTEXT D-08..D-14, D-17..D-19, D-21, D-23, D-26; Python
// `Backend/app/payment/routes.py` (webhook receivers), `Backend/app/core/
// webhook_auth.py` (verify_efipay_webhook_token — FAIL-CLOSED D-12/D-21),
// `Backend/app/payment/service.py` process_pix_webhook (229-304) +
// process_card_webhook (464-573)):
//   - D-10/D-04 topology: receivers live at top-level `/payment/webhook/*`
//     (NOT under /api) — frozen paths POST /payment/webhook/pix and
//     POST /payment/webhook/efipay.
//   - D-12/D-21 FAIL-CLOSED auth: missing env WEBHOOK_SECRET OR missing/
//     mismatched `webhook_token` query param → 401 PT-BR, NO processing, NO
//     Efí call, NO re-query. NEVER logs the secret (T-25-03).
//   - D-14: raw body preserved — `req.text()` read BEFORE any JSON parse
//     (spy asserts text() precedes the live re-query).
//   - D-13: NEVER trust the webhook body — PIX receiver re-queries live
//     via getPixChargeStatus(txid); card receiver round-trips the
//     `notification` token via getCardChargeStatus (get_notification parity).
//     R1 assert 3 — the plan's "identificadorPagamento" resolves to the SAME
//     field Python reads: `data[].identifiers.charge_id` (service.py:485-486).
//   - D-09/D-18/D-26 idempotency: confirmPayment twice with the same
//     providerChargeId grants ONCE; second call returns {grantedScopes: []}
//     (parity service.py:517 — already-paid no-op).
//   - D-19/D-23 content-only grant: scope = `ContentAccess:content:{uuid}`
//     appended to the buyer's User.scopes — NEVER a blanket "premium" grant.
//   - D-17: confirm-payment.ts REGISTERS into pix.ts's setConfirmPaymentHook
//     registry so the poll path invokes the SAME idempotent transition.
//   - T-25-03: PT-BR errors; webhook_token/notification values never logged.
//
// NOTE: the plan's "mock @/server/db" target is `@/lib/prisma` (the singleton
// exporting the `prisma` client, per the 29-02/29-03 precedent). Prisma field
// names are snake_case (efipay_charge_pix_id, efipay_charge_card_id,
// payment_status, payment_method, paid_at, ...).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  return {
    callOrder,
    efiRequestSpy: vi.fn(),
    getPixChargeStatusSpy: vi.fn(),
    getCardChargeStatusSpy: vi.fn(),
    setConfirmPaymentHookSpy: vi.fn(),
    prisma: {
      $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
      pixCharge: { findUnique: vi.fn(), update: vi.fn() },
      order: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      contentPurchase: { findFirst: vi.fn(), update: vi.fn() },
      user: { findUnique: vi.fn(), update: vi.fn() },
    },
  };
});

vi.mock("@/lib/payments/efi-client", () => ({
  efiRequest: mocks.efiRequestSpy,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/lib/payments/pix", () => ({
  getPixChargeStatus: mocks.getPixChargeStatusSpy,
  setConfirmPaymentHook: mocks.setConfirmPaymentHookSpy,
}));

vi.mock("@/lib/payments/card", () => ({
  getCardChargeStatus: mocks.getCardChargeStatusSpy,
}));

// ─── Parity fixtures ────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "segredo-teste-webhook-42";
const TXID = "txid-webhook-1";
const CARD_NOTIFICATION_TOKEN = "tok-notif-abc123";
const CARD_CHARGE_ID = "charge-12345";
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c";
const CONTENT_UUID = "9b10c111-2222-4333-8444-555566667777";
const ORDER_ID = 7;
const USER_ID = 3;

/** Frozen receiver URL — top-level /payment/webhook/*, token via query (D-10/D-12). */
function pixRequest(raw: string, token?: string | null): Request {
  const query = token === undefined || token === null ? "" : `?webhook_token=${token}`;
  return new Request(`http://localhost/payment/webhook/pix${query}`, {
    method: "POST",
    body: raw,
  });
}

/** Frozen receiver URL — card notification (D-11/D-12). */
function cardRequest(raw: string, token?: string | null): Request {
  const query = token === undefined || token === null ? "" : `?webhook_token=${token}`;
  return new Request(`http://localhost/payment/webhook/efipay${query}`, {
    method: "POST",
    body: raw,
  });
}

/** Pix path DB stubs — PixCharge row + PENDING order + linked content purchase. */
function stubPixConfirmDb(status: "PENDING" | "PAID" = "PENDING") {
  mocks.prisma.pixCharge.findUnique.mockResolvedValue({
    id: 1,
    txid: TXID,
    status: "ATIVA",
    order_id: ORDER_ID,
    end_to_end_id: null,
    paid_at: null,
  });
  mocks.prisma.pixCharge.update.mockResolvedValue({ id: 1, txid: TXID });
  mocks.prisma.order.findUnique.mockResolvedValue({
    id: ORDER_ID,
    uuid: ORDER_UUID,
    payment_status: status,
    user_id: USER_ID,
  });
  mocks.prisma.order.update.mockResolvedValue({ id: ORDER_ID, uuid: ORDER_UUID });
  mocks.prisma.contentPurchase.findFirst.mockResolvedValue({
    id: 9,
    user_id: USER_ID,
    content_id: 4,
    efipay_charge_pix_id: TXID,
    efipay_charge_card_id: null,
    paid_at: null,
    content: { uuid: CONTENT_UUID },
  });
  mocks.prisma.contentPurchase.update.mockResolvedValue({ id: 9 });
  mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID, scopes: ["basic"] });
  mocks.prisma.user.update.mockResolvedValue({ id: USER_ID });
}

/** Card path DB stubs — PENDING order (by efipay_charge_card_id) + content purchase. */
function stubCardConfirmDb() {
  mocks.prisma.order.findFirst.mockResolvedValue({
    id: ORDER_ID,
    uuid: ORDER_UUID,
    payment_status: "PENDING",
    user_id: USER_ID,
  });
  mocks.prisma.order.update.mockResolvedValue({ id: ORDER_ID, uuid: ORDER_UUID });
  mocks.prisma.contentPurchase.findFirst.mockResolvedValue({
    id: 9,
    user_id: USER_ID,
    content_id: 4,
    efipay_charge_pix_id: null,
    efipay_charge_card_id: CARD_CHARGE_ID,
    paid_at: null,
    content: { uuid: CONTENT_UUID },
  });
  mocks.prisma.contentPurchase.update.mockResolvedValue({ id: 9 });
  mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID, scopes: ["basic"] });
  mocks.prisma.user.update.mockResolvedValue({ id: USER_ID });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.callOrder.length = 0;
  vi.resetModules();
  vi.stubEnv("WEBHOOK_SECRET", WEBHOOK_SECRET);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("receivePixWebhook — fail-closed token auth (D-12/D-21)", () => {
  it("returns 401 PT-BR with NO webhook_token, without touching Efí or the re-query", async () => {
    const { receivePixWebhook } = await import("./webhook");

    const res = await receivePixWebhook(pixRequest(JSON.stringify({ txid: TXID }), undefined));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Não autorizado. Webhook inválido." });
    // FAIL-CLOSED — nothing downstream ran (D-12/D-21; parity webhook_auth.py)
    expect(mocks.getPixChargeStatusSpy).not.toHaveBeenCalled();
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 PT-BR for a WRONG webhook_token, without any downstream work", async () => {
    const { receivePixWebhook } = await import("./webhook");

    const res = await receivePixWebhook(
      pixRequest(JSON.stringify({ txid: TXID }), "token-errado"),
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Não autorizado. Webhook inválido." });
    expect(mocks.getPixChargeStatusSpy).not.toHaveBeenCalled();
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });

  it("returns 401 when WEBHOOK_SECRET env is missing — fail-closed, NO dev backdoor (D-12)", async () => {
    vi.stubEnv("WEBHOOK_SECRET", "");
    const { receivePixWebhook } = await import("./webhook");

    const res = await receivePixWebhook(pixRequest(JSON.stringify({ txid: TXID })));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Não autorizado. Webhook inválido." });
    expect(mocks.getPixChargeStatusSpy).not.toHaveBeenCalled();
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });
});

describe("receivePixWebhook — raw-body-first + live re-query + confirm (D-13/D-14)", () => {
  it("reads req.text() FIRST, then re-queries Efí, then confirms the order as PAID/CONFIRMED/PIX", async () => {
    // D-14 — raw bytes preserved: text() is consumed BEFORE any JSON parse /
    // re-query. The spy pins the ordering.
    const textSpy = vi.spyOn(Request.prototype, "text").mockImplementation(function (
      this: Request,
    ) {
      mocks.callOrder.push("text");
      return Promise.resolve(JSON.stringify({ txid: TXID }));
    });
    // D-13 — the receiver NEVER trusts the webhook body: live re-query decides.
    mocks.getPixChargeStatusSpy.mockImplementation(async () => {
      mocks.callOrder.push("requery");
      return { status: "PAID", charge: { status: "CONCLUIDA" } };
    });
    stubPixConfirmDb();

    const { receivePixWebhook } = await import("./webhook");
    const res = await receivePixWebhook(
      new Request(`http://localhost/payment/webhook/pix?webhook_token=${WEBHOOK_SECRET}`, {
        method: "POST",
        body: JSON.stringify({ txid: TXID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 1 });
    expect(mocks.callOrder).toEqual(["text", "requery"]);
    expect(mocks.getPixChargeStatusSpy).toHaveBeenCalledWith(TXID);
    // D-18 — idempotent transition via the shared confirm-payment module:
    // order → PAID + CONFIRMED + PIX + paid_at (no stock re-reserve — D-08).
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        payment_status: "PAID",
        status: "CONFIRMED",
        payment_method: "PIX",
        paid_at: expect.any(Date),
      },
    });
    textSpy.mockRestore();
  });
});

describe("receiveCardWebhook — notification-token parity (R1 assert 3, D-13)", () => {
  it("resolves the Efí card webhook through identifiers.charge_id and confirms CREDIT_CARD", async () => {
    // Python parity routes.py:123-133 → service.py:473-487: the webhook body
    // carries ONLY the `notification` token; providerChargeId comes from the
    // get_notification round-trip — `data[].identifiers.charge_id`
    // (the plan's "identificadorPagamento" resolves to THIS field).
    mocks.getCardChargeStatusSpy.mockResolvedValue({
      providerChargeId: CARD_CHARGE_ID,
      status: "PAID",
    });
    stubCardConfirmDb();

    const { receiveCardWebhook } = await import("./webhook");
    const res = await receiveCardWebhook(
      cardRequest(JSON.stringify({ notification: CARD_NOTIFICATION_TOKEN }), WEBHOOK_SECRET),
    );

    expect(res.status).toBe(200);
    expect(mocks.getCardChargeStatusSpy).toHaveBeenCalledWith(CARD_NOTIFICATION_TOKEN);
    // Confirm ran against the RESOLVED charge id (never the raw body itself).
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        payment_status: "PAID",
        status: "CONFIRMED",
        payment_method: "CREDIT_CARD",
        paid_at: expect.any(Date),
      },
    });
  });

  it("ignores a card webhook without a notification token (parity routes.py:127-133), 200 no-op", async () => {
    mocks.getCardChargeStatusSpy.mockResolvedValue({
      providerChargeId: "",
      status: "PENDING",
    });
    const { receiveCardWebhook } = await import("./webhook");

    const res = await receiveCardWebhook(
      cardRequest(JSON.stringify({ status: "paid", charge_id: "x" }), WEBHOOK_SECRET),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ignored", reason: "no notification token" });
    expect(mocks.getCardChargeStatusSpy).not.toHaveBeenCalled();
    expect(mocks.prisma.order.update).not.toHaveBeenCalled();
  });
});

describe("receive*Webhook — errored live re-query ACKs 200 no-op, never 500s (WR-02)", () => {
  it("ACKs a PIX event when the live re-query throws (parity service.py:476-478)", async () => {
    mocks.getPixChargeStatusSpy.mockRejectedValue(new Error("Efí unreachable"));
    const { receivePixWebhook } = await import("./webhook");

    const res = await receivePixWebhook(pixRequest(JSON.stringify({ txid: TXID }), WEBHOOK_SECRET));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 0 });
    // Never confirm on an unverified payment; never 500 into an Efí re-delivery loop.
    expect(mocks.getPixChargeStatusSpy).toHaveBeenCalledWith(TXID);
    expect(mocks.prisma.order.update).not.toHaveBeenCalled();
  });

  it("ACKs a card event when the notification round-trip throws", async () => {
    mocks.getCardChargeStatusSpy.mockRejectedValue(new Error("Efí unreachable"));
    const { receiveCardWebhook } = await import("./webhook");

    const res = await receiveCardWebhook(
      cardRequest(JSON.stringify({ notification: CARD_NOTIFICATION_TOKEN }), WEBHOOK_SECRET),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 0 });
    expect(mocks.getCardChargeStatusSpy).toHaveBeenCalledWith(CARD_NOTIFICATION_TOKEN);
    expect(mocks.prisma.order.update).not.toHaveBeenCalled();
  });
});

describe("receivePixWebhook — batch processing of ALL settled events (WR-03)", () => {
  it("confirms EVERY txid in the pix[] batch, ACKing the processed count (parity service.py:238)", async () => {
    const TXID_2 = "txid-webhook-2";
    mocks.getPixChargeStatusSpy.mockImplementation(async (txid: string) => ({
      status: "PAID",
      charge: { status: "CONCLUIDA", txid },
    }));
    // Each confirmed charge needs its own PixCharge row (confirm-payment pix branch).
    mocks.prisma.pixCharge.findUnique.mockImplementation(async ({ where }: { where: { txid: string } }) =>
      where.txid === TXID
        ? { id: 1, txid: TXID, status: "ATIVA", order_id: ORDER_ID, end_to_end_id: null, paid_at: null }
        : { id: 2, txid: TXID_2, status: "ATIVA", order_id: ORDER_ID, end_to_end_id: null, paid_at: null },
    );
    mocks.prisma.pixCharge.update.mockResolvedValue({ id: 1 });
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      uuid: ORDER_UUID,
      payment_status: "PENDING",
      user_id: USER_ID,
    });
    mocks.prisma.order.update.mockResolvedValue({ id: ORDER_ID, uuid: ORDER_UUID });
    mocks.prisma.contentPurchase.findFirst.mockResolvedValue(null);

    const { receivePixWebhook } = await import("./webhook");
    const res = await receivePixWebhook(
      new Request(`http://localhost/payment/webhook/pix?webhook_token=${WEBHOOK_SECRET}`, {
        method: "POST",
        body: JSON.stringify({ pix: [{ txid: TXID }, { txid: TXID_2 }] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 2 });
    expect(mocks.getPixChargeStatusSpy).toHaveBeenNthCalledWith(1, TXID);
    expect(mocks.getPixChargeStatusSpy).toHaveBeenNthCalledWith(2, TXID_2);
    // Both orders transitioned — previously ONLY the first txid was processed.
    expect(mocks.prisma.order.update).toHaveBeenCalledTimes(2);
  });

  it("dedupes a txid that appears both top-level and inside pix[] (one confirmation)", async () => {
    mocks.getPixChargeStatusSpy.mockImplementation(async (txid: string) => ({
      status: txid === TXID ? "PAID" : "PENDING",
      charge: { status: txid === TXID ? "CONCLUIDA" : "ATIVA" },
    }));
    stubPixConfirmDb();

    const { receivePixWebhook } = await import("./webhook");
    const res = await receivePixWebhook(
      new Request(`http://localhost/payment/webhook/pix?webhook_token=${WEBHOOK_SECRET}`, {
        method: "POST",
        body: JSON.stringify({ txid: TXID, pix: [{ txid: TXID }, { txid: "txid-nao-pago" }] }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 1 });
    expect(mocks.getPixChargeStatusSpy).toHaveBeenCalledTimes(2); // TXID + nao-pago
    expect(mocks.prisma.order.update).toHaveBeenCalledTimes(1);
  });

  it("threads the settlement endToEndId from the LIVE re-query into pixCharge (WR-04, service.py:271)", async () => {
    mocks.getPixChargeStatusSpy.mockImplementation(async () => ({
      status: "PAID",
      charge: { status: "CONCLUIDA", pix: [{ endToEndId: "E1234567890-ABC" }] },
    }));
    stubPixConfirmDb();

    const { receivePixWebhook } = await import("./webhook");
    const res = await receivePixWebhook(
      new Request(`http://localhost/payment/webhook/pix?webhook_token=${WEBHOOK_SECRET}`, {
        method: "POST",
        body: JSON.stringify({ txid: TXID }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", processed: 1 });
    // D-13 — the id came from the live re-query, never the body; persisted on
    // the charge row (parity service.py:271).
    expect(mocks.prisma.pixCharge.update).toHaveBeenCalledWith({
      where: { txid: TXID },
      data: expect.objectContaining({
        status: "CONCLUIDA",
        end_to_end_id: "E1234567890-ABC",
      }),
    });
  });
});

describe("confirmPayment — card instant-approval repair (CR-01)", () => {
  it("completes the CONFIRMED/grant transition for an already-PAID but unfulfilled card order, then no-ops on re-delivery", async () => {
    // CR-01: createCardOneStep persisted payment_status PAID (service.py:430-
    // 440) before confirmPayment ran — the order is PAID but status is not
    // CONFIRMED and the ContentPurchase/scope grant never happened. The card
    // guard must repair exactly this state (previously a permanent no-op), and
    // stay a no-op once the grant has run (D-18 idempotency).
    mocks.prisma.order.findFirst.mockResolvedValue({
      id: ORDER_ID,
      uuid: ORDER_UUID,
      payment_status: "PAID",
      user_id: USER_ID,
      status: null,
    });
    // 1st contentPurchase.findFirst = the "already paid?" idempotency probe →
    // null (not done, proceed). 2nd = the grant lookup → the purchase row.
    mocks.prisma.contentPurchase.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 9,
        user_id: USER_ID,
        content_id: 4,
        efipay_charge_pix_id: null,
        efipay_charge_card_id: CARD_CHARGE_ID,
        paid_at: null,
        content: { uuid: CONTENT_UUID },
      });
    mocks.prisma.contentPurchase.update.mockResolvedValue({ id: 9 });
    mocks.prisma.order.update.mockResolvedValue({ id: ORDER_ID, uuid: ORDER_UUID });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID, scopes: ["basic"] });
    mocks.prisma.user.update.mockResolvedValue({ id: USER_ID });

    const { confirmPayment } = await import("./confirm-payment");
    const result = await confirmPayment({
      providerChargeId: CARD_CHARGE_ID,
      family: "card",
    });

    // The end-state that was previously dead: order CONFIRMED + scope granted.
    const expectedScope = `ContentAccess:content:${CONTENT_UUID}`;
    expect(result.grantedScopes).toEqual([expectedScope]);
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        payment_status: "PAID",
        status: "CONFIRMED",
        payment_method: "CREDIT_CARD",
        paid_at: expect.any(Date),
      },
    });
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { scopes: ["basic", expectedScope] },
    });

    // Idempotency — a late webhook re-delivery now no-ops (purchase paid).
    mocks.prisma.contentPurchase.findFirst.mockReset().mockResolvedValue({
      id: 9,
      efipay_charge_card_id: CARD_CHARGE_ID,
      paid_at: new Date(),
      content: { uuid: CONTENT_UUID },
    });
    const second = await confirmPayment({
      providerChargeId: CARD_CHARGE_ID,
      family: "card",
    });
    expect(second.grantedScopes).toEqual([]);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1); // no double-grant (D-17/D-18)
  });
});

describe("confirmPayment — idempotency (D-09/D-18/D-26, parity service.py:517)", () => {
  it("grants ONCE for the same pix charge; the second call returns {grantedScopes: []}", async () => {
    stubPixConfirmDb();
    const { confirmPayment } = await import("./confirm-payment");

    const first = await confirmPayment({ providerChargeId: TXID, family: "pix" });
    expect(first.grantedScopes).toEqual([`ContentAccess:content:${CONTENT_UUID}`]);
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.order.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.pixCharge.update).toHaveBeenCalledTimes(1);

    // Second confirmPayment sees the order already PAID (idempotency guard).
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      uuid: ORDER_UUID,
      payment_status: "PAID",
      user_id: USER_ID,
    });
    const second = await confirmPayment({ providerChargeId: TXID, family: "pix" });
    expect(second.grantedScopes).toEqual([]);
    // NO double-grant, NO second transition, NO second pix-charge write (D-17/D-18).
    expect(mocks.prisma.user.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.order.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.pixCharge.update).toHaveBeenCalledTimes(1);
  });

  it("returns {grantedScopes: []} for an unknown txid (parity service.py:243-248)", async () => {
    mocks.prisma.pixCharge.findUnique.mockResolvedValue(null);
    const { confirmPayment } = await import("./confirm-payment");

    const result = await confirmPayment({ providerChargeId: "txid-desconhecido", family: "pix" });

    expect(result.grantedScopes).toEqual([]);
    expect(mocks.prisma.order.update).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it("REPAIRS a crash window: charge already CONCLUIDA + order still PENDING (WR-09, parity service.py:278-284)", async () => {
    // Pre-WR-09, `status === "CONCLUIDA"` short-circuited here — a crash
    // between the two writes froze the order PENDING forever. Now idempotency
    // is keyed off the ORDER and both writes commit via $transaction.
    mocks.prisma.pixCharge.findUnique.mockResolvedValue({
      id: 1,
      txid: TXID,
      status: "CONCLUIDA", // charge concluded BEFORE this confirm ran
      order_id: ORDER_ID,
      end_to_end_id: "E1234567890-ABC",
      paid_at: new Date("2026-09-14T11:59:00.000Z"),
    });
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      uuid: ORDER_UUID,
      payment_status: "PENDING", // ...but the order never transitioned
      user_id: USER_ID,
    });
    mocks.prisma.pixCharge.update.mockResolvedValue({ id: 1, txid: TXID });
    mocks.prisma.order.update.mockResolvedValue({ id: ORDER_ID, uuid: ORDER_UUID });
    mocks.prisma.contentPurchase.findFirst.mockResolvedValue({
      id: 9,
      user_id: USER_ID,
      content_id: 4,
      efipay_charge_pix_id: TXID,
      efipay_charge_card_id: null,
      paid_at: null,
      content: { uuid: CONTENT_UUID },
    });
    mocks.prisma.contentPurchase.update.mockResolvedValue({ id: 9 });
    mocks.prisma.user.findUnique.mockResolvedValue({ id: USER_ID, scopes: ["basic"] });
    mocks.prisma.user.update.mockResolvedValue({ id: USER_ID });

    const { confirmPayment } = await import("./confirm-payment");
    const result = await confirmPayment({
      providerChargeId: TXID,
      family: "pix",
      endToEndId: "E1234567890-ABC",
    });

    // The repair ran: order PAID + CONFIRMED (previously dead).
    expect(result.grantedScopes).toEqual([`ContentAccess:content:${CONTENT_UUID}`]);
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        payment_status: "PAID",
        status: "CONFIRMED",
        payment_method: "PIX",
        paid_at: expect.any(Date),
      },
    });
    // WR-09 — both writes went through the SAME $transaction.
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    // WR-04 — the threaded end-to-end id persisted on the charge.
    expect(mocks.prisma.pixCharge.update).toHaveBeenCalledWith({
      where: { txid: TXID },
      data: expect.objectContaining({ status: "CONCLUIDA", end_to_end_id: "E1234567890-ABC" }),
    });
  });
});

describe("confirmPayment — content-only scope grant (D-19/D-23)", () => {
  it("grants ContentAccess:content:{uuid} to the buyer scopes — NEVER a blanket premium scope", async () => {
    stubPixConfirmDb();
    const { confirmPayment } = await import("./confirm-payment");

    const result = await confirmPayment({ providerChargeId: TXID, family: "pix" });

    const expectedScope = `ContentAccess:content:${CONTENT_UUID}`;
    expect(result.grantedScopes).toEqual([expectedScope]);
    // Grant = append to User.scopes (["basic"] → ["basic", scope]); the update
    // is the grant — content-only (D-19), no "premium" blanket (D-23).
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { scopes: ["basic", expectedScope] },
    });
    const scopesWritten = JSON.stringify(mocks.prisma.user.update.mock.calls[0]);
    expect(scopesWritten).not.toContain("premium");
  });
});

describe("confirm-payment — D-17 reconcile hook wiring", () => {
  it("registers the real confirmPayment into setConfirmPaymentHook (29-02 registry)", async () => {
    const registered: Array<(txid: string) => Promise<void>> = [];
    mocks.setConfirmPaymentHookSpy.mockImplementation((hook: (txid: string) => Promise<void>) => {
      registered.push(hook);
    });
    stubPixConfirmDb();

    await import("./confirm-payment");

    expect(mocks.setConfirmPaymentHookSpy).toHaveBeenCalledTimes(1);
    expect(registered).toHaveLength(1);
    // The registered hook drives the SAME idempotent confirm (family pix) —
    // the D-17 poll path (getPixChargeStatus PAID → hook(txid)).
    await registered[0]("txid-hook-reconcile");

    expect(mocks.prisma.pixCharge.findUnique).toHaveBeenCalledWith({
      where: { txid: "txid-hook-reconcile" },
    });
    expect(mocks.prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ payment_status: "PAID", payment_method: "PIX" }),
      }),
    );
  });
});