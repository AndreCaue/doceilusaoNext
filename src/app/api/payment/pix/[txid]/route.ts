// GET /api/payment/pix/[txid] — live PIX status for the 5s poll (D-15).
//
// Plan 29-05 App Router surfacing over getPixChargeStatus (29-02):
//   → { txid, status }  (status: PENDING | PAID | EXPIRED | CANCELED | FAILED)
//
// Auth: session required. IDOR guard: the polled charge must belong to the
// actor. D-13: the status is a LIVE Efí re-query (never cached state).
//
// Webhook-parity reconcile (29-05 task 1: "call the shared confirmPayment via
// the webhook parity path"): PAID → confirmPayment (29-04, idempotent D-18).
// Importing confirm-payment also self-registers the D-17 poll hook inside
// pix.ts, so polling and the (future) webhook receivers converge on the same
// idempotent transition.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getPixChargeStatus } from "@/lib/payments/pix";
import { confirmPayment } from "@/lib/payments/confirm-payment";
import {
  invalidRequestResponse,
  paymentErrorResponse,
  requireAuth,
  resolveDbUserId,
  unauthorizedResponse,
} from "@/lib/payments/route-helpers";

type RouteContext = { params: Promise<{ txid: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const user = await requireAuth(req);
    const dbUserId = await resolveDbUserId(user.uuid);
    if (!dbUserId) return unauthorizedResponse();

    const { txid } = await ctx.params;
    if (!txid) return invalidRequestResponse();

    // IDOR guard — only the OWNER of the charge may poll its status.
    const order = await prisma.order.findFirst({
      where: { efipay_charge_pix_id: txid, user_id: dbUserId },
      select: { uuid: true },
    });
    if (!order) {
      return NextResponse.json(
        { error: "Cobrança não encontrada", code: "CHARGE_NOT_FOUND", retryable: false },
        { status: 404 },
      );
    }

    const { status } = await getPixChargeStatus(txid);

    // Webhook-parity reconcile — idempotent (D-18); also validates that a
    // payment that landed while no webhook receiver was mounted still CONFIRMS
    // the order + grants the content scope (D-19/D-23).
    if (status === "PAID") {
      await confirmPayment({ providerChargeId: txid, family: "pix" });
    }

    return NextResponse.json({ txid, status });
  } catch (err) {
    return paymentErrorResponse(err);
  }
}