// POST /api/payment/card/one-step — tokenized one-step charge (D-20/D-21).
//
// Plan 29-05 App Router surfacing over createCardOneStep (29-03):
//   body { orderUuid, payment_token, parcelas } → { status, chargeId }
//   status: PAID | PENDING | FAILED (EFI_CARD_STATUS_MAP — D-16).
//
// Auth: session required. IDOR guard: order must belong to the actor.
// D-21: raw PAN/cvv/card_token NEVER cross this route — the browser
// payment-token-efi SDK produces payment_token client-side and only that
// token is sent here (pinned by card.test.ts).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createCardOneStep } from "@/lib/payments/card";
import { confirmPayment } from "@/lib/payments/confirm-payment";
import {
  invalidRequestResponse,
  paymentErrorResponse,
  requireAuth,
  resolveDbUserId,
  unauthorizedResponse,
} from "@/lib/payments/route-helpers";

// 29-06 parity keys: payment_token / parcelas (Efí vocabulary), orderUuid
// canonical uuid (not an int id — the successor identifies orders by uuid).
const bodySchema = z.object({
  orderUuid: z.string().uuid(),
  payment_token: z.string().min(1),
  parcelas: z.number().int().min(1).max(12),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireAuth(req);
    const dbUserId = await resolveDbUserId(user.uuid);
    if (!dbUserId) return unauthorizedResponse();

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalidRequestResponse();

    // IDOR guard — payment actions are user-scoped.
    const order = await prisma.order.findUnique({
      where: { uuid: parsed.data.orderUuid },
      include: { shipping: true },
    });
    if (!order || order.user_id !== dbUserId) {
      return NextResponse.json(
        { error: "Pedido não encontrado", code: "ORDER_NOT_FOUND", retryable: false },
        { status: 404 },
      );
    }

    if (order.payment_status === "PAID") {
      return NextResponse.json(
        { error: "Pagamento já confirmado", code: "PAYMENT_ALREADY_PAID", retryable: false },
        { status: 409 },
      );
    }

    const bank = order.shipping;
    if (!bank || !bank.recipient_document || !bank.recipient_name) {
      return NextResponse.json(
        { error: "Dados do comprador incompletos", code: "BUYER_INCOMPLETE", retryable: false },
        { status: 400 },
      );
    }

    const result = await createCardOneStep({
      paymentToken: parsed.data.payment_token,
      installments: parsed.data.parcelas,
      order: {
        uuid: order.uuid,
        grandTotalCents: Math.round((order.total ?? 0) * 100),
        buyer: { cpf: bank.recipient_document, name: bank.recipient_name },
      },
    });

    // CR-01 — instant approval: card.ts persists payment_status PAID (parity
    // service.py:430-440), but the D-18 CONFIRMED + ContentAccess grant lives
    // in confirmPayment (card branch). The Efí card webhook is NOT a reliable
    // delivery mechanism — drive the idempotent transition synchronously here,
    // otherwise the buyer is charged and never granted access.
    if (result.status === "PAID") {
      await confirmPayment({ providerChargeId: result.chargeId, family: "card" });
    }

    return NextResponse.json({ status: result.status, chargeId: result.chargeId });
  } catch (err) {
    return paymentErrorResponse(err);
  }
}