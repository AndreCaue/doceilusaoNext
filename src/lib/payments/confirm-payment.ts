// Shared idempotent payment confirmation + content-scope grant (Plan 29-04).
//
// SERVER-ONLY module — never import from a client component (D-05).
//
// Parity (29-CONTEXT D-08, D-09, D-13, D-17..D-19, D-23, D-26; Python
// `Backend/app/payment/service.py` process_pix_webhook (229-304),
// process_card_webhook (464-573) + confirm_payment (505-543)):
//   - D-09/D-18/D-26 idempotency: payment_status PENDING → PAID exactly once;
//     any other state (or a missing charge/order/purchase/user) is a no-op
//     returning {grantedScopes: []} (parity service.py:241-248/517).
//   - D-13: this module is NEVER fed by the webhook body directly — callers
//     pass the LIVE re-query result (providerChargeId/txid resolution happens
//     in webhook.ts after getPixChargeStatus/getCardChargeStatus).
//   - D-19/D-23 content-only grant: the buyer gains `ContentAccess:content:
//     {uuid}` appended to User.scopes — never a blanket "premium" grant.
//   - D-08: NO stock re-reservation here — checkout already reserved.
//   - T-25-03: no secret/log-able values ever interpolated.
//
// D-17 — the module SELF-REGISTERS into pix.ts's hook registry so the 29-02
// poll path reconciles through the SAME idempotent transition the webhook
// uses. pix.ts holds the registry (no import cycle: pix.ts never imports
// this module).

import { prisma } from "@/lib/prisma";
import { setConfirmPaymentHook } from "@/lib/payments/pix";

// ─── Public contracts (consumed by 29-05/29-06 routes) ───────────────────────

export type ContentScope = `ContentAccess:content:${string}`;

export type ConfirmPaymentInput = {
  providerChargeId: string;
  family: "pix" | "card";
  /** WR-04 — Efí's end-to-end id for the settlement, threaded from the LIVE
   * re-query by the webhook receiver (parity service.py:271 persists
   * pix_list[0]'s endToEndId onto pix_charge.end_to_end_id). */
  endToEndId?: string;
};

export type ConfirmPaymentResult = { grantedScopes: ContentScope[] };

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * User.scopes is a Json column — normalize array | "a,b" string | null into a
 * plain string[] (Phase 26 auth precedent).
 */
function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((s) => String(s)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

// ─── Confirmation + grant (parity service.py confirm_payment 505-543) ───────

export async function confirmPayment(
  charge: ConfirmPaymentInput,
): Promise<ConfirmPaymentResult> {
  const { providerChargeId, family } = charge;

  // D-18 — idempotency widget: PENDING orders transition exactly once; ANY
  // other state (or a missing charge/order/purchase/user) is a no-op
  // returning {grantedScopes: []} (parity service.py:241-248/517).
  if (family === "pix") {
    // service.py:241-248 — unknown charge → silent no-op.
    const pixCharge = await prisma.pixCharge.findUnique({
      where: { txid: providerChargeId },
    });
    if (!pixCharge) return { grantedScopes: [] };
    // WR-09 — idempotency is keyed off the ORDER, not the charge status. A
    // charge already CONCLUIDA with a still-PENDING order means a crash
    // happened between the two writes; the next event REPAIRS it (parity
    // service.py:278-284 commits BOTH within one transaction — there is no
    // 'already concluded → no-op' short-circuit in Python).
    const order = await prisma.order.findUnique({
      where: { id: pixCharge.order_id ?? -1 },
    });
    if (!order || order.payment_status !== "PENDING") return { grantedScopes: [] };

    const paidAt = new Date();
    // service.py:271-279 — conclude the charge. WR-04 — a fresh end_to_end_id
    // arrives from the LIVE re-query (never the webhook body); an existing
    // value is preserved when no fresh id arrives (idempotent re-delivery).
    const endToEndId = charge.endToEndId ?? pixCharge.end_to_end_id;
    // D-18/WR-09 — both writes commit atomically: no window where the charge
    // is CONCLUIDA and the order is still PENDING (the only acceptable
    // 'CONCLUIDA + PENDING' is the crash-window one, and it self-repairs).
    await prisma.$transaction([
      prisma.pixCharge.update({
        where: { txid: providerChargeId },
        data: {
          status: "CONCLUIDA",
          paid_at: paidAt,
          ...(endToEndId ? { end_to_end_id: endToEndId } : {}),
        },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: {
          payment_status: "PAID",
          status: "CONFIRMED",
          payment_method: "PIX",
          paid_at: paidAt,
        },
      }),
    ]);
  } else {
    // Card: order linked by efipay_charge_card_id (service.py:505-513).
    // NOTE: efipay_charge_card_id is a plain index (not @unique) — findFirst.
    const order = await prisma.order.findFirst({
      where: { efipay_charge_card_id: providerChargeId },
    });
    if (!order) return { grantedScopes: [] };
    // D-18 idempotency: PENDING → PAID once. CR-01 exception — the one-step
    // path persists payment_status PAID in card.ts (service.py:430-440) BEFORE
    // this module runs, so the CONFIRMED/grant transition may still be
    // pending: an already-paid-but-unfulfilled order (purchase not yet paid
    // for THIS charge) proceeds to complete it. A purchase already paid means
    // the whole confirmation already ran → no-op (idempotent, D-18).
    if (order.payment_status !== "PENDING") {
      const done = await prisma.contentPurchase.findFirst({
        where: { efipay_charge_card_id: providerChargeId, paid_at: { not: null } },
      });
      if (done) return { grantedScopes: [] };
    }
    await prisma.order.update({
      where: { id: order.id },
      data: {
        payment_status: "PAID",
        status: "CONFIRMED",
        payment_method: "CREDIT_CARD",
        paid_at: new Date(),
      },
    });
  }

  // D-19 — content-only grant: find the purchase row for this charge id.
  // (service.py:258-262 strikes ContentPurchase by efipay_charge_pix_id; the
  // card branch uses efipay_charge_card_id the same way).
  const purchase = await prisma.contentPurchase.findFirst({
    where: {
      OR: [
        { efipay_charge_pix_id: providerChargeId },
        { efipay_charge_card_id: providerChargeId },
      ],
    },
    include: { content: true },
  });
  if (!purchase) return { grantedScopes: [] };

  // Mark the purchase paid (parity service.py:305-311 pix; card branch same).
  await prisma.contentPurchase.update({
    where: { id: purchase.id },
    data: {
      paid_at: new Date(),
      payment_method: family === "pix" ? "PIX" : "CREDIT_CARD",
    },
  });

  const buyer = await prisma.user.findUnique({ where: { id: purchase.user_id } });
  if (!buyer) return { grantedScopes: [] };

  // D-23 — scope is content-only: `ContentAccess:content:{uuid}`, appended
  // (never replacing) the buyer's existing scopes. Idempotent: an already
  // present scope is NOT rewritten (D-18/D-26).
  const scope: ContentScope = `ContentAccess:content:${purchase.content.uuid}`;
  const current = normalizeScopes(buyer.scopes);
  if (current.includes(scope)) return { grantedScopes: [] };

  await prisma.user.update({
    where: { id: buyer.id },
    data: { scopes: [...current, scope] },
  });
  return { grantedScopes: [scope] };
}

// ─── D-17 self-registration ──────────────────────────────────────────────────
// Wired at module scope so importing confirm-payment (from the webhook module
// OR any later route) registers the reconcile hook exactly once. The hook
// drives the SAME idempotent transition — poll-reconcile and webhook converge.
setConfirmPaymentHook(async (txid: string) => {
  await confirmPayment({ providerChargeId: txid, family: "pix" });
});