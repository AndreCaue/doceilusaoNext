// Card refund engine — the complete guarded + locked state transition
// (Plan 30-02, ORDER-04). Consumed by plan 30-05's POST /api/payment/refund-card
// route.
//
// SERVER-ONLY module — never import from a client component.
//
// Parity (30-CONTEXT D-05/D-07/D-09/D-13; Python
// `Backend/app/payment/routes.py` L158-192 — the `#Feature` route this
// refactors; `card-flow.md` L262 terminal-state machine):
//
//   D-05 chain order — network BEFORE locks:
//     1. Guard reads on the order row (404/403/400/400-idempotent) with NO Efí
//        traffic on non-actionable requests.
//     2. Amount validation (integer, > 0, capped at the order total cents —
//        Math.round per the D-06 zero-float-drift rule).
//     3. LIVENESS (D-13): live charge-status check via getCardChargeDetails —
//        must be "paid" (normalized object/scalar shape — the upstream Python
//        bug fix). EfiError propagates as-is → route maps to 502/503.
//     4. Efí refund OUTSIDE the DB transaction (no network under row locks —
//        Phase 28 CR-01 precedent). Failure propagates; the tx never starts
//        (funds-safe ordering — no DB transition without Efí success).
//     5. Single interactive $transaction: SELECT ... FOR UPDATE re-lock of the
//        order row + in-tx re-check (race guard — the transition happens
//        exactly once even if a webhook re-delivery won between steps 3-4 and
//        5), grouped reserved_stock release per product_id by sum(quantity)
//        with a Math.max(0, ...) clamp (reserved_stock never negative), and
//        the terminal state payment_status → REFUNDED + order.status →
//        CANCELED (card-flow.md:262 — the webhook path reconciliation
//        expects; writing REFUNDED would flip to CANCELED on webhook
//        re-delivery: a state-machine fight. CANCELED is the stable terminal).
//
// Rejections use the D-12 shape { error, code, retryable: false } with
// distinct D-07 codes; Efí transport errors pass through unchanged.

import { Prisma } from "@prisma/client";
import { getCardChargeDetails, refundCardCharge } from "@/lib/payments/efi-client";
import { prisma } from "@/lib/prisma";

export type RefundInput = { orderUuid: string; userId: number; amount?: number };

export type RefundResult = { status: "success"; message: string; response: unknown };

export type RefundRejection = {
  error: string;
  code:
    | "REFUND_NOT_FOUND"
    | "REFUND_FORBIDDEN"
    | "REFUND_NO_CHARGE"
    | "REFUND_ALREADY_DONE"
    | "REFUND_INVALID_STATUS"
    | "REFUND_AMOUNT_INVALID";
  retryable: false;
};

/**
 * Complete card refund transition (D-05).
 *
 * Throws a `RefundRejection` (D-12 shape, retryable: false) for every guarded
 * failure path, or propagates the raw `EfiError` from the transport for
 * reachability/refund failures (the route maps those to 502/503 via
 * paymentErrorResponse).
 */
export async function requestCardRefund(input: RefundInput): Promise<RefundResult> {
  // 1. Guard reads (routes.py:165-171 parity) — fail-closed, zero Efí traffic.
  const order = await prisma.order.findFirst({ where: { uuid: input.orderUuid } });
  if (!order) {
    throw rejection("Pedido não encontrado", "REFUND_NOT_FOUND");
  }
  if (order.user_id !== input.userId) {
    throw rejection("Sem permissão", "REFUND_FORBIDDEN");
  }
  if (!order.efipay_charge_card_id) {
    throw rejection("Pedido sem cobrança de cartão", "REFUND_NO_CHARGE");
  }
  if (order.payment_status === "REFUNDED") {
    throw rejection("Estorno já realizado", "REFUND_ALREADY_DONE");
  }
  const chargeId = order.efipay_charge_card_id;

  // 2. Partial-amount validation (D-06 integer + zero-float-drift cap).
  if (input.amount !== undefined) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw rejection("Amount deve ser positivo em centavos", "REFUND_AMOUNT_INVALID");
    }
    const totalCents = Math.round((order.total ?? 0) * 100);
    if (input.amount > totalCents) {
      throw rejection("Valor do estorno excede o total do pedido", "REFUND_AMOUNT_INVALID");
    }
  }

  // 3. LIVENESS (D-13) — never trust stale state before a money-moving action.
  const live = await getCardChargeDetails(chargeId);
  if (live.status !== "paid") {
    throw rejection(`Status inválido para estorno: ${live.status}`, "REFUND_INVALID_STATUS");
  }

  // 4. Efí refund OUTSIDE the transaction (no network under row locks).
  const refundResult = await refundCardCharge(chargeId, input.amount);

  // 5. Complete transition under row locks (WR-09-style atomicity).
  await prisma.$transaction(async (tx) => {
    // Re-lock the order row and re-fetch payment_status (race guard).
    const lockedOrders = await tx.$queryRaw<Array<{ id: number; payment_status: string | null }>>`
      SELECT id, payment_status FROM orders WHERE uuid = ${input.orderUuid} FOR UPDATE
    `;
    const lockedOrder = lockedOrders[0];
    if (!lockedOrder || lockedOrder.payment_status === "REFUNDED") {
      throw rejection("Estorno já realizado", "REFUND_ALREADY_DONE");
    }

    // Resolve item quantities grouped by product_id summing quantity.
    const grouped = await tx.orderItem.groupBy({
      by: ["product_id"],
      where: { order_id: lockedOrder.id },
      _sum: { quantity: true },
    });

    // Lock the products this order reserved, then release the reserved stock.
    const productIds = grouped.map((g) => g.product_id);
    const lockedProducts = await tx.$queryRaw<
      Array<{ id: number; stock: number; reserved_stock: number | null }>
    >`
      SELECT id, stock, reserved_stock FROM products WHERE id IN (${Prisma.join(productIds)}) FOR UPDATE
    `;
    for (const g of grouped) {
      const product = lockedProducts.find((p) => p.id === g.product_id);
      if (!product) continue;
      await tx.product.update({
        where: { id: g.product_id },
        data: { reserved_stock: Math.max(0, (product.reserved_stock ?? 0) - (g._sum.quantity ?? 0)) },
      });
    }

    // Terminal state per card-flow.md:262 (webhook-parity). CANCELED is the
    // stable terminal — writing REFUNDED would flip to CANCELED on the next
    // webhook re-delivery.
    await tx.order.update({
      where: { id: lockedOrder.id },
      data: { payment_status: "REFUNDED", status: "CANCELED", updated_at: new Date() },
    });
  });

  return { status: "success", message: refundResult.message, response: refundResult.response };
}

function rejection(error: string, code: RefundRejection["code"]): RefundRejection {
  return { error, code, retryable: false };
}