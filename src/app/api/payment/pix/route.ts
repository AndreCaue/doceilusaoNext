// POST /api/payment/pix — create the PIX charge + QR payload for an order.
//
// Plan 29-05 App Router surfacing over createPixCharge (29-02):
//   body { orderUuid } → { txid, imagem_qrcode, pix_copia_e_cola }
//   (Efí parity keys — Frontend PixPayment.tsx + 29-06 plan consume snake_case).
//
// Auth: session required. IDOR guard: the order must belong to the actor
// (checkout/[uuid]/page.tsx precedent). D-09 idempotency lives in the lib —
// a second POST for the same order returns the SAME charge (no new cob).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { createPixCharge } from "@/lib/payments/pix";
import {
  invalidRequestResponse,
  paymentErrorResponse,
  requireAuth,
  resolveDbUserId,
  unauthorizedResponse,
} from "@/lib/payments/route-helpers";

const bodySchema = z.object({ orderUuid: z.string().uuid() });

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

    // Paid orders never mint a second charge (double-charge guard).
    if (order.payment_status === "PAID") {
      return NextResponse.json(
        { error: "Pagamento já confirmado", code: "PAYMENT_ALREADY_PAID", retryable: false },
        { status: 409 },
      );
    }

    const pixKey = process.env.PIX_KEY ?? "";
    if (!pixKey) {
      return NextResponse.json(
        { error: "Chave PIX não configurada", code: "PAYMENT_MISCONFIGURED", retryable: false },
        { status: 500 },
      );
    }

    const bank = order.shipping;
    if (!bank || !bank.recipient_document || !bank.recipient_name) {
      return NextResponse.json(
        { error: "Dados do comprador incompletos", code: "BUYER_INCOMPLETE", retryable: false },
        { status: 400 },
      );
    }

    const created = await createPixCharge({
      uuid: order.uuid,
      grandTotalCents: Math.round((order.total ?? 0) * 100),
      buyer: { cpf: bank.recipient_document, name: bank.recipient_name },
      pixKey,
      // D-07 floor (60min) applies inside the lib; a missing reservation clock
      // falls back to 6h so the charge is never minted pre-expiry (D-08).
      expiresAt:
        order.reservation_expires_at ?? new Date(Date.now() + 6 * 60 * 60 * 1000),
    });

    // Efí parity keys (snake_case — Frontend PixPayment + 29-06 contract).
    return NextResponse.json({
      txid: created.qr.txid,
      imagem_qrcode: created.qr.imagemQrcode,
      pix_copia_e_cola: created.qr.pixCopiaECola,
    });
  } catch (err) {
    return paymentErrorResponse(err);
  }
}