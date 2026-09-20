// Card one-step payment + installments (Plan 29-03 — parity service.py).
//
// SERVER-ONLY module — never import from a client component (D-05).
//
// Parity (29-CONTEXT D-06, D-11, D-12, D-16, D-21, D-22; Python
// `Backend/app/payment/service.py` create_card_one_step (316-462) +
// get_card_installments (575-617); `card-flow.md` MIGRATION notes 342/363/377):
//   - D-06: card family = "cobrancas" host → POST /v1/charge/card/one-step,
//     GET /v1/charge/card/installments?total={cents}&brand={brand} (paths
//     VERIFIED against card-flow.md — the plan's draft "/v1/charge/one-step"
//     and "/v1/credit-card/installments/{brand}" were corrected).
//   - D-21: the ONLY card credential this server ever holds is the browser
//     `payment_token`; raw PAN/cvv/card_token NEVER cross this module (this
//     is pinned by card.test.ts — no pan|card_number|cvv|card_token keys).
//   - service.py:375-401 body parity: items[{name, amount, value(int cents)}],
//     metadata{notification_url (D-11), custom_id=order_{uuid}},
//     payment.credit_card{payment_token, installments, customer{...},
//     billing_address{...}}, optional shippings[] when shipping_cost > 0.
//   - D-12: a 400-class Efí error on the one-step call is a card refusal →
//     EFI_INVALID_CARD (retryable:false, PT-BR, no token leak — T-25-03);
//     retryable codes (429/5xx/network) pass through unchanged.
//   - D-16 card parity: AUTHORIZED/approved/paid → PAID (service.py:433);
//     failed/error/refused → FAILED (service.py:442/536); waiting/unpaid →
//     PENDING; unknown → PENDING (non-fatal).
//   - service.py:430-440 persistence: efipay_charge_card_id always; PAID also
//     sets payment_status + payment_method + paid_at (order.status CONFIRMED
//     is deliberately NOT set here — D-18: the shared confirm-payment module
//     (29-04) owns the state transition).
//   - D-22: installments options {installment, installment_value,
//     total_value, interest_percentage, has_interest} — NUMBERS (frontend
//     CardPayment.tsx:160-163 formats with .toFixed(2)); brand allowlist
//     visa/mastercard/elo/amex/hipercard (service.py:579).
//
// DEV: item value conversion uses Math.round(unit_price*100) — a deliberate
// deviation from Python's int() truncation (45.99*100 = 4598.999… → 4598, an
// upstream off-by-one-cent bug). D-06 mandates ZERO float drift.

import { efiRequest } from "@/lib/payments/efi-client";
import { getEfiSandboxConfig } from "../../../lib/efi-cert";
import { prisma } from "@/lib/prisma";
import type { EfiError } from "@/lib/payments/types";
import type { PaymentStatus } from "./pix";

export type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "hipercard";

export type CardChargeResult = {
  chargeId: string;
  status: PaymentStatus;
  paidAt?: Date;
};

export type CardOneStepInput = {
  /** efipay payment_token — browser SDK output (D-21); NEVER a raw PAN. */
  paymentToken: string;
  /** 1..12 (D-22) — validated by the route (later plan); passed through here. */
  installments: number;
  order: {
    uuid: string;
    grandTotalCents: number;
    buyer: { cpf: string; name: string };
  };
};

export type CardInstallmentOption = {
  installment: number;
  installment_value: number;
  total_value: number;
  interest_percentage: number;
  has_interest: boolean;
};

// ─── Internal state ─────────────────────────────────────────────────────────

/** D-22 — allowlist parity service.py:579. */
const CARD_BRANDS: readonly CardBrand[] = ["visa", "mastercard", "elo", "amex", "hipercard"];

/** D-16 card parity — Efí charge status vocabulary → PaymentStatus (service.py). */
const EFI_CARD_STATUS_MAP: Record<string, PaymentStatus> = {
  AUTHORIZED: "PAID", // one-step immediate-authorization vocabulary
  approved: "PAID", // service.py:433
  paid: "PAID", // service.py:433
  failed: "FAILED", // service.py:442
  error: "FAILED", // service.py:442
  refused: "FAILED", // webhook parity service.py:536
  waiting: "PENDING", // webhook parity service.py:560
  unpaid: "PENDING",
};

/** D-12 error shape (PT-BR, never interpolates secrets — T-25-03). */
function cardError(error: string, code: string, retryable: boolean): EfiError {
  return { error, code, retryable };
}

/**
 * D-11 — the card webhook receiver URL is per-charge (in the charge body).
 * Base host follows service.py:17-20 (NGROK_URL in sandbox, WEBHOOK_URL in
 * prod); path is the frozen Next receiver `POST /payment/webhook/efipay`
 * with the D-12 query-token.
 */
function buildNotificationUrl(): string {
  // WR-07 — derive the sandbox branch from the SHARED config (single source,
  // accepts "true"/"1", case-insensitive — parity efi-cert.ts/efi-client.ts).
  // The previous strict "==='true'" check silently treated EFI_SANDBOX=1 as
  // production, composing a PROD notification_url for sandbox card calls,
  // which also stripped the D-12 webhook_token entirely.
  const { sandbox } = getEfiSandboxConfig();
  const base = sandbox ? process.env.NGROK_URL ?? "" : process.env.WEBHOOK_URL ?? "";
  return `${base}/payment/webhook/efipay?webhook_token=${process.env.WEBHOOK_SECRET ?? ""}`;
}

// ─── One-step card charge (parity service.py create_card_one_step 316-462) ───

export async function createCardOneStep(input: CardOneStepInput): Promise<CardChargeResult> {
  const { paymentToken, installments, order } = input;

  // Read order + shipping + items (parity service.py:317-373 reads).
  const dbOrder = await prisma.order.findUnique({
    where: { uuid: order.uuid },
    include: { shipping: true, items: true },
  });
  if (!dbOrder) {
    throw cardError("Pedido não encontrado", "ORDER_NOT_FOUND", false);
  }
  // CR-02 — single-charge + paid_at guards (parity service.py:325-327/330-334,
  // dropped in the TypeScript port). A double-tap / second tab must NEVER mint
  // a new Efí charge over an existing one: overwriting efipay_charge_card_id
  // orphans the older charge, and a later payment on it double-charges the
  // buyer undetected.
  if (dbOrder.efipay_charge_card_id) {
    throw cardError("Este pedido já possui uma cobrança de cartão associada", "EFI_INVALID_REQUEST", false);
  }
  if (dbOrder.paid_at) {
    throw cardError("Este pedido já está em processo de pagamento", "PAYMENT_ALREADY_PAID", false);
  }
  // D-08/WR-06 — fail-closed parity with createPixCharge (pix.ts): an expired
  // reservation can never mint a card charge. Missing clock → treated as live
  // (the route decides the 6h fallback policy, not this lib).
  if (dbOrder.reservation_expires_at && dbOrder.reservation_expires_at.getTime() <= Date.now()) {
    throw cardError("O prazo de reserva deste pedido expirou", "PAYMENT_EXPIRED", false);
  }
  const shipping = dbOrder.shipping;
  if (!shipping) {
    throw cardError("Dados de entrega não encontrados no pedido", "ORDER_NOT_FOUND", false);
  }
  if (dbOrder.items.length === 0) {
    throw cardError("Pedido sem itens", "ORDER_NOT_FOUND", false);
  }

  // service.py:352-354 — phone digits only (10-11 digits).
  const phoneDigits = shipping.recipient_phone.replace(/\D/g, "");

  // service.py:375-401 body parity. Item values are INT cents (D-06 — the
  // successor uses Math.round instead of Python's int() truncation, which
  // drops a cent on 45.99*100 = 4598.999…).
  const body: Record<string, unknown> = {
    items: dbOrder.items.map((oi) => ({
      name: oi.product_name,
      amount: oi.quantity,
      value: Math.round(oi.unit_price * 100),
    })),
    metadata: {
      notification_url: buildNotificationUrl(), // D-11 per-charge receiver
      custom_id: `order_${order.uuid}`,
    },
    payment: {
      credit_card: {
        payment_token: paymentToken, // D-21 — never raw pan/cvv/card_token
        installments,
        customer: {
          name: order.buyer.name,
          email: shipping.recipient_email,
          cpf: order.buyer.cpf,
          phone_number: phoneDigits,
        },
        billing_address: {
          street: shipping.street,
          number: shipping.number,
          neighborhood: shipping.neighborhood,
          zipcode: shipping.postal_code,
          city: shipping.city,
          state: shipping.state,
        },
      },
    },
  };

  // service.py:403-407 — shippings only when shipping_cost > 0.
  if (dbOrder.shipping_cost > 0) {
    body.shippings = [
      {
        name: `Frete - ${dbOrder.shipping_carrier} ${dbOrder.shipping_method}`,
        value: Math.round(dbOrder.shipping_cost * 100),
      },
    ];
  }

  let chargeId: string | undefined;
  let chargeStatus: string | undefined;
  try {
    const result = await efiRequest<{ charge_id?: string; status?: string }>({
      family: "cobrancas",
      path: "/v1/charge/card/one-step",
      method: "POST",
      body,
    });
    chargeId = result.charge_id;
    chargeStatus = result.status;
  } catch (err) {
    // D-12 — a 400 on the one-step call is a card refusal (service.py:413-418
    // surfaces it as a user-facing error). Retryable codes pass through
    // unchanged so callers can back off. Never echoes the token (T-25-03).
    if ((err as EfiError)?.code === "EFI_INVALID_REQUEST") {
      throw cardError("Cartão recusado pela operadora", "EFI_INVALID_CARD", false);
    }
    throw err;
  }

  if (!chargeId) {
    throw cardError("Efí não retornou charge_id", "EFI_INVALID_REQUEST", false);
  }
  const chargeIdStr = String(chargeId);
  const status = EFI_CARD_STATUS_MAP[chargeStatus ?? ""] ?? "PENDING";

  // Persistent order markers (service.py:430-440).
  if (status === "PAID") {
    const paidAt = new Date();
    await prisma.order.update({
      where: { uuid: order.uuid },
      data: {
        efipay_charge_card_id: chargeIdStr,
        payment_status: "PAID",
        payment_method: "CREDIT_CARD",
        paid_at: paidAt,
      },
    });
    return { chargeId: chargeIdStr, status, paidAt };
  }

  // service.py:442-444 — failed/error/refused → FAILED + CANCELED.
  if (status === "FAILED") {
    await prisma.order.update({
      where: { uuid: order.uuid },
      data: {
        efipay_charge_card_id: chargeIdStr,
        payment_status: "FAILED",
        status: "CANCELED",
      },
    });
    return { chargeId: chargeIdStr, status };
  }

  // waiting/unpaid/unknown — link the charge, stay PENDING (non-fatal).
  await prisma.order.update({
    where: { uuid: order.uuid },
    data: { efipay_charge_card_id: chargeIdStr },
  });
  return { chargeId: chargeIdStr, status };
}

// ─── Card charge notification status (parity get_notification, D-13/D-16) ────

export type CardChargeStatus = { providerChargeId: string; status: PaymentStatus };

/**
 * D-13 — card webhook re-query parity: the Efí card webhook body carries only
 * a `notification` token; the provider charge id + status resolve through the
 * get_notification round trip (card-flow.md:365; service.py:469-487) — the
 * plan's "identificadorPagamento" IS `data[].identifiers.charge_id` on the
 * LAST event, with `status.current` mapped via EFI_CARD_STATUS_MAP (D-16).
 */
export async function getCardChargeStatus(
  notificationToken: string,
): Promise<CardChargeStatus> {
  const result = await efiRequest<{
    data?: Array<{
      identifiers?: { charge_id?: unknown };
      status?: { current?: string };
    }>;
  }>({
    family: "cobrancas",
    path: `/v1/charge/notification/${encodeURIComponent(notificationToken)}`,
    method: "GET",
  });

  const events = result.data ?? [];
  const last = events[events.length - 1] ?? events[0];
  const chargeId = last?.identifiers?.charge_id;
  const current = last?.status?.current ?? "";
  const status = EFI_CARD_STATUS_MAP[current] ?? "PENDING";

  return {
    providerChargeId: chargeId === undefined || chargeId === null ? "" : String(chargeId),
    status,
  };
}

// ─── Installments estimator (parity service.py get_card_installments 575-617) ─

export async function getCardInstallments(
  brand: CardBrand,
  totalCents: number,
): Promise<{ installments: CardInstallmentOption[] }> {
  // D-22 brand allowlist (service.py:579-584) — PT-BR parity message.
  if (!CARD_BRANDS.includes(brand)) {
    throw cardError(
      `Bandeira '${brand}' inválida. Use: ${CARD_BRANDS.join(", ")}`,
      "EFI_INVALID_REQUEST",
      false,
    );
  }

  // VERIFIED endpoint (card-flow.md:342/377): GET /v1/charge/card/installments
  // with query params total (cents) + brand, on the cobrancas host (D-06).
  const result = await efiRequest<{
    data?: {
      installments?: Array<{
        installment: number;
        value: number;
        interest_percentage?: number;
        has_interest?: boolean;
      }>;
    };
  }>({
    family: "cobrancas",
    path: `/v1/charge/card/installments?total=${totalCents}&brand=${brand}`,
    method: "GET",
  });

  // service.py:604-612 — value/total are cents in the Efí payload; the
  // successor returns reais NUMBERS (frontend CardPayment.tsx:160-163 formats
  // with .toFixed(2)); unknown → 0/false defaults (service.py:610-611).
  const installments = (result.data?.installments ?? []).map((opt) => ({
    installment: opt.installment,
    installment_value: opt.value / 100,
    total_value: (opt.installment * opt.value) / 100,
    interest_percentage: opt.interest_percentage ?? 0,
    has_interest: opt.has_interest ?? false,
  }));

  return { installments };
}