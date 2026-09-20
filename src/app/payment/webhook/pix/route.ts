// POST /payment/webhook/pix — Efí PIX webhook receiver (frozen topology D-10).
//
// Gap closure (29-06): this App Router route is the THIN HTTP surface over
// receivePixWebhook (doceilusao-next/src/lib/payments/webhook.ts — 29-04
// business logic). ALL processing lives there: fail-closed webhook_token auth
// (D-12/D-21, constant-time compare, 401 PT-BR before ANY body read), raw-body
// first (D-14), D-13 live re-query (never trust the body), idempotent
// confirmPayment (D-18). Nothing is re-implemented here.
//
// Topology (frozen — do NOT move under /api):
//   - D-10/D-11: TOP-LEVEL path matches the PIX webhook registration
//     `{NGROK_URL|WEBHOOK_URL}/payment/webhook/pix?webhook_token=...`
//     (.env.example WEBHOOK_URL contract; card.ts buildNotificationUrl parity).
//   - The edge middleware matches /admin/:path* ONLY (src/middleware.ts), so
//     this route is reached directly — auth is IN-ROUTE and cannot be bypassed
//     by the gate.
//   - The strangler-proxy catch-all lives at /api/[...path]; this top-level
//     namespace has no proxy route, explicit App Router routes answer it.
//   - D-12 "rate-limit receivers where cheap": per-IP sliding-window limiter
//     (src/lib/auth/rate-limit.ts) bounds re-query abuse of the D-13 live Efí
//     call. 60/min per IP is far above legit Efí event traffic.
//
// Runtime: nodejs (D-05 — prisma/efi mTLS imports are server-only).

import { NextRequest, NextResponse } from "next/server";

import { ip } from "@/lib/auth/ip";
import { rateLimit } from "@/lib/auth/rate-limit";
import { receivePixWebhook } from "@/lib/payments/webhook";

export const runtime = "nodejs";

const RATE_LIMIT_MAX = 60;

export async function POST(req: NextRequest): Promise<Response> {
  const rl = rateLimit(`payment-webhook-pix:${ip(req)}`, RATE_LIMIT_MAX);
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
  return receivePixWebhook(req);
}