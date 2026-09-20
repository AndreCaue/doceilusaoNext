// POST /payment/webhook/efipay — Efí card webhook receiver (frozen topology
// D-10/D-11).
//
// Gap closure (29-06): this App Router route is the THIN HTTP surface over
// receiveCardWebhook (doceilusao-next/src/lib/payments/webhook.ts — 29-04
// business logic). ALL processing lives there: fail-closed webhook_token auth
// (D-12/D-21, constant-time compare, 401 PT-BR before ANY body read), raw-body
// first (D-14), D-13 notification-token round trip (get_notification parity —
// the body carries ONLY the token, the charge id resolves from
// data[].identifiers.charge_id), idempotent confirmPayment (D-18). Nothing is
// re-implemented here.
//
// Topology (frozen — do NOT move under /api):
//   - D-11: TOP-LEVEL path matches card.ts buildNotificationUrl()
//     `{NGROK_URL|WEBHOOK_URL}/payment/webhook/efipay?webhook_token=...`
//     (per-charge notification_url in the one-step charge body; .env.example
//     WEBHOOK_URL contract). Card orders reach order.status CONFIRMED (D-13)
//     ONLY via this receiver.
//   - The edge middleware matches /admin/:path* ONLY (src/middleware.ts), so
//     this route is reached directly — auth is IN-ROUTE and cannot be bypassed
//     by the gate.
//   - The strangler-proxy catch-all lives at /api/[...path]; this top-level
//     namespace has no proxy route, explicit App Router routes answer it.
//   - D-12 "rate-limit receivers where cheap": per-IP sliding-window limiter
//     (src/lib/auth/rate-limit.ts) bounds notification-token round-trip abuse
//     of the D-13 live Efí call. 60/min per IP is far above legit Efí traffic.
//
// Runtime: nodejs (D-05 — prisma/efi mTLS imports are server-only).

import { NextRequest, NextResponse } from "next/server";

import { ip } from "@/lib/auth/ip";
import { rateLimit } from "@/lib/auth/rate-limit";
import { receiveCardWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const rl = rateLimit(`payment-webhook-efipay:${ip(req)}`, RATE_LIMIT_MAX);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Muitas tentativas. Tente novamente em instantes.",
        code: "RATE_LIMITED",
        retryable: true,
      },
      { status: 429 },
    );
  }
  return receiveCardWebhook(req);
}