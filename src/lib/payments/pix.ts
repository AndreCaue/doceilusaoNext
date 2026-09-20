// PIX charge flow (Plan 29-02 — create cob + QR + status polling).
//
// SERVER-ONLY module — never import from a client component (D-05).
//
// Parity (29-CONTEXT D-03, D-06..D-09, D-13, D-16, D-17; Python
// `Backend/app/payment/service.py` create_pix_charge (101-227) +
// process_pix_webhook (229-304) + `Backend/app/payment/routes.py`):
//   - D-07: `calendario.expiracao` = reservation remaining minutes (min 60).
//   - D-06: `valor.original` = grandTotalCents/100 toFixed(2) — ZERO float
//     drift ("159.90", never "159.9"); `chave` from the pixKey (env parity).
//   - D-03: txid = the Efí-generated one; fallback is a deterministic
//     URL-safe Base64 (≤35 chars, NOT a full UUID) so the same orderUuid
//     always maps to the same txid (raw-devolution parity, D-01).
//   - D-09/D-26: idempotency — same orderUuid → same charge with ONE Efí call
//     (in-process cache + persisted PixCharge lookup for cold caches); the
//     order's payment markers are set once, never re-reserved (D-08).
//   - D-08: reservation expired → EfiError PAYMENT_EXPIRED (fail-closed).
//   - D-13: getPixChargeStatus re-queries Efí live — never trusts cached state.
//   - D-16: Efí status → PaymentStatus map (CONCLUIDA→PAID parity).
//   - D-17: PAID reconciles through an injected confirmation hook (wired by
//     29-04 confirm-payment.ts); advisory — the webhook stays primary, and a
//     hook failure never fails the poll read.
//   - T-25-03: PT-BR errors; never leak tokens or the PIX key.

import { randomUUID } from "node:crypto";
import { efiRequest } from "@/lib/payments/efi-client";
import { prisma } from "@/lib/prisma";
import type { EfiError } from "@/lib/payments/types";

// ─── Public contracts (consumed by 29-04 webhook + 29-06 UI) ────────────────

export type PaymentStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELED" | "FAILED";

export type PixChargeCreated = {
  charge: {
    txid: string;
    location?: string;
    pixCopiaECola?: string;
    imagemQrcode?: string;
    devedorCpf?: string;
    devedorNome?: string;
    valorOriginal: number;
    status: string;
    orderId?: number;
  };
  qr: { imagemQrcode?: string; pixCopiaECola?: string; txid: string };
};

export type PixChargeStatus = { status: PaymentStatus; charge?: unknown };

/**
 * D-17 — confirmation hook. 29-04's shared confirm-payment module registers
 * here; pix.ts holds NO hard dependency on it, so the poll path works before
 * the webhook plan lands (no import cycle, no premature coupling).
 */
export type ConfirmPaymentHook = (txid: string) => Promise<void>;

let confirmPaymentHook: ConfirmPaymentHook | undefined;

export function setConfirmPaymentHook(hook: ConfirmPaymentHook): void {
  confirmPaymentHook = hook;
}

// ─── Internal state ─────────────────────────────────────────────────────────

/** D-09/D-26 — in-process idempotency cache (orderUuid → created charge). */
const chargeCache = new Map<string, PixChargeCreated>();

/** D-16 — Efí PIX status vocabulary → PaymentStatus (parity service.py). */
const EFI_PIX_STATUS_MAP: Record<string, PaymentStatus> = {
  ATIVA: "PENDING",
  CONCLUIDA: "PAID",
  EXPIRADA: "EXPIRED",
  REMOVIDA_PELO_USUARIO_RECEBEDOR: "CANCELED",
};

/** D-08/D-09 — reservation lifetime floor for calendario.expiracao (minutes). */
const MIN_EXPIRACAO_MINUTES = 60;

/** D-12 error shape (PT-BR, never interpolates secrets — T-25-03). */
function pixError(error: string, code: string, retryable: boolean): EfiError {
  return { error, code, retryable };
}

/**
 * D-03 — deterministic URL-safe Base64 txid fallback (≤35 chars, NOT a full
 * UUID). Derived from the order uuid so the same order always maps to the
 * same txid. Only used when Efí omits `txid` in the create response
 * (raw-devolution parity — D-01).
 */
function generateTxid(orderUuid: string): string {
  const hex = orderUuid.replace(/-/g, "");
  return Buffer.from(hex, "hex").toString("base64url").replace(/=+$/, "").slice(0, 35);
}

// ─── PIX charge creation (parity service.py create_pix_charge 101-227) ──────

export async function createPixCharge(order: {
  uuid: string;
  grandTotalCents: number;
  buyer: { cpf: string; name: string };
  pixKey: string;
  expiresAt: Date;
}): Promise<PixChargeCreated> {
  // D-08/D-09 — fail-closed: an expired reservation can never mint a charge.
  if (order.expiresAt.getTime() <= Date.now()) {
    throw pixError("O prazo de reserva deste pedido expirou", "PAYMENT_EXPIRED", false);
  }

  // D-09/D-26 — idempotency, warm path: same request flow reuses the charge.
  const cached = chargeCache.get(order.uuid);
  if (cached) return cached;

  const dbOrder = await prisma.order.findUnique({ where: { uuid: order.uuid } });
  if (!dbOrder) {
    throw pixError("Pedido não encontrado", "ORDER_NOT_FOUND", false);
  }

  // D-09/D-26 — idempotency, cold path (serverless restart): the order already
  // references a charge → same txid, SAME QR, NO second Efí call.
  // NOTE: the Prisma client exposes the schema's snake_case field names
  // (efipay_charge_pix_id, pix_copia_e_cola, ...); the public API below keeps
  // the camelCase contract.
  if (dbOrder.efipay_charge_pix_id) {
    const persisted = await prisma.pixCharge.findUnique({
      where: { txid: dbOrder.efipay_charge_pix_id },
    });
    if (persisted) {
      // WR-10 — cold cache (serverless restart): NEVER trust the persisted
      // status as payable. Parity Python re-queries an existing charge and
      // updates its row (service.py:110-127). The live re-query also persists
      // terminal states (WR-05) before we decide.
      let live: PixChargeStatus;
      try {
        live = await getPixChargeStatus(persisted.txid);
      } catch {
        // Efí unreachable — keep serving the persisted charge; the poll
        // route's own D-13 re-query surfaces terminal states later.
        live = { status: "PENDING" };
      }
      if (live.status === "EXPIRED" || live.status === "CANCELED") {
        // Fail-closed: a dead charge must never be re-presented as payable —
        // re-mint requires a fresh reservation (checkout flow, D-03).
        throw pixError("O prazo de reserva deste pedido expirou", "PAYMENT_EXPIRED", false);
      }
      const restored: PixChargeCreated = {
        charge: {
          txid: persisted.txid,
          location: persisted.location ?? undefined,
          pixCopiaECola: persisted.pix_copia_e_cola ?? undefined,
          imagemQrcode: persisted.imagem_qrcode ?? undefined,
          devedorCpf: persisted.devedor_cpf ?? undefined,
          devedorNome: persisted.devedor_nome ?? undefined,
          valorOriginal: persisted.valor_original,
          status: persisted.status ?? "ATIVA",
          orderId: persisted.order_id ?? undefined,
        },
        qr: {
          imagemQrcode: persisted.imagem_qrcode ?? undefined,
          pixCopiaECola: persisted.pix_copia_e_cola ?? undefined,
          txid: persisted.txid,
        },
      };
      chargeCache.set(order.uuid, restored);
      return restored;
    }
  }

  // D-07 — reservation remaining minutes, floored at 60.
  const expiracao = Math.max(
    MIN_EXPIRACAO_MINUTES,
    Math.ceil((order.expiresAt.getTime() - Date.now()) / 60_000),
  );
  // D-06 — ZERO float drift: cents/100 formatted to exactly 2 decimals.
  const valorOriginal = (order.grandTotalCents / 100).toFixed(2);

  const body = {
    calendario: { expiracao },
    devedor: { nome: order.buyer.name, cpf: order.buyer.cpf },
    valor: { original: valorOriginal },
    chave: order.pixKey,
    solicitacaoPagador: `${process.env.STORE_NAME ?? "Doce Ilusão"} - Pedido #${order.uuid}`,
  };

  const result = await efiRequest<{
    txid?: string;
    loc?: { location?: string };
    pixCopiaECola?: string;
    imagemQrcode?: string;
  }>({ family: "pix", path: "/v2/cob", method: "POST", body });

  const txid = result.txid ?? generateTxid(order.uuid);

  // Persist PixCharge (parity service.py:201-211) — status ATIVA, mirroring
  // the Efí payload + devedor snapshot (snake_case Prisma field names).
  await prisma.pixCharge.create({
    data: {
      uuid: randomUUID(),
      txid,
      location: result.loc?.location,
      pix_copia_e_cola: result.pixCopiaECola,
      imagem_qrcode: result.imagemQrcode,
      devedor_cpf: order.buyer.cpf,
      devedor_nome: order.buyer.name,
      valor_original: Number.parseFloat(valorOriginal),
      status: "ATIVA",
      order_id: dbOrder.id,
    },
  });

  // Link the order to the charge + payment markers (parity routes.py:81;
  // D-08 — no stock re-reservation here, checkout already reserved;
  // snake_case Prisma field names).
  await prisma.order.update({
    where: { uuid: order.uuid },
    data: {
      efipay_charge_pix_id: txid,
      payment_status: "PENDING",
      payment_method: "PIX",
    },
  });

  const created: PixChargeCreated = {
    charge: {
      txid,
      location: result.loc?.location,
      pixCopiaECola: result.pixCopiaECola,
      imagemQrcode: result.imagemQrcode,
      devedorCpf: order.buyer.cpf,
      devedorNome: order.buyer.name,
      valorOriginal: Number.parseFloat(valorOriginal),
      status: "ATIVA",
      orderId: dbOrder.id,
    },
    qr: {
      imagemQrcode: result.imagemQrcode,
      pixCopiaECola: result.pixCopiaECola,
      txid,
    },
  };

  chargeCache.set(order.uuid, created);
  return created;
}

// ─── PIX status poll (parity service.py process_pix_webhook map + routes.py) ─

export async function getPixChargeStatus(txid: string): Promise<PixChargeStatus> {
  // D-13 — live re-query: never trust cached/stale state.
  const detail = await efiRequest<{ status?: string } & Record<string, unknown>>({
    family: "pix",
    path: `/v2/cob/${txid}`,
    method: "GET",
  });

  // WR-08 — an unknown Efí vocabulary term is treated as STILL IN FLIGHT
  // (PENDING), never FAILED: a vocabulary drift mid-transaction must not
  // sever the poll loop and strand a payable charge.
  const status = EFI_PIX_STATUS_MAP[detail.status ?? ""] ?? "PENDING";

  // WR-05 — persist terminal states (EXPIRADA / REMOVIDA) so the DB agrees
  // with Efí: the order's payment_status must not stay PENDING forever after
  // the charge dies (parity service.py:286-298; D-08 — cancel/expired releases
  // stock, it never re-reserves). Best-effort: a persistence failure must
  // NEVER fail the status read (D-13) — both the poll route and the webhook
  // receiver converge HERE on every live re-query.
  if (status === "EXPIRED" || status === "CANCELED") {
    try {
      const row = await prisma.pixCharge.findUnique({ where: { txid } });
      if (row?.order_id != null) {
        await prisma.order.update({
          where: { id: row.order_id },
          data: { payment_status: status, status: "CANCELED" },
        });
      }
    } catch {
      // best-effort terminal persistence — never fails the read (D-13)
    }
  }

  // D-17 — reconcile-on-poll (advisory): the injected 29-04 confirmation
  // module runs the SAME idempotent transition the webhook uses. A hook
  // failure must NEVER fail the poll read — the webhook stays primary.
  if (status === "PAID") {
    try {
      await confirmPaymentHook?.(txid);
    } catch {
      // best-effort reconcile (D-17)
    }
  }

  return status === "PAID" ? { status, charge: detail } : { status };
}