// Efí webhook receivers — PIX + card (Plan 29-04).
//
// SERVER-ONLY module — never import from a client component (D-05).
//
// Frozen topology (29-CONTEXT D-04, D-10, D-11, D-12, D-13, D-14, D-21;
// Python parity `Backend/app/payment/routes.py` webhook receivers +
// `Backend/app/core/webhook_auth.py` verify_efipay_webhook_token):
//   - D-10/D-04: receivers are TOP-LEVEL routes — POST /payment/webhook/pix
//     (PIX) and POST /payment/webhook/efipay (card). The /api/* variants in
//     the plan's files_modified are the App Router surfacing contracts for
//     29-05/29-06 — this module is the shared business logic.
//   - D-12/D-21 FAIL-CLOSED auth: missing env WEBHOOK_SECRET OR missing/
//     mismatched `?webhook_token=` query param → 401 PT-BR, NO body read, NO
//     Efí call, NO re-query (parity webhook_auth.py — no dev backdoor).
//     Constant-time comparison; the secret is never logged (T-25-03).
//   - D-14: raw body preserved — req.text() is consumed BEFORE any JSON
//     parse, so the original bytes always reach the handler.
//   - D-13: NEVER trust the webhook body. PIX re-queries live via
//     getPixChargeStatus(txid); card round-trips the `notification` token via
//     getCardChargeStatus (get_notification parity — the plan's
//     "identificadorPagamento" resolves to `data[].identifiers.charge_id`,
//     service.py:485-486).
//   - PAID → the SAME idempotent confirm-payment module the poll path uses
//     (D-17); non-PAID / ignored events answer 200 no-op (Efí ack).

import { getPixChargeStatus } from "@/lib/payments/pix";
import { getCardChargeStatus } from "@/lib/payments/card";
import { confirmPayment } from "@/lib/payments/confirm-payment";
import type { PixChargeStatus } from "@/lib/payments/pix";
import type { CardChargeStatus } from "@/lib/payments/card";

const UNAUTHORIZED = JSON.stringify({ error: "Não autorizado. Webhook inválido." });

function unauthorized(): Response {
  return new Response(UNAUTHORIZED, {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * D-12/D-21 — constant-time compare (parity hmac.compare_digest in
 * webhook_auth.py). Fail-closed: empty env secret or missing/mismatched
 * query token → false.
 */
function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorizeWebhook(req: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET ?? "";
  if (!secret) return false; // fail-closed — no env, no trust (D-12)
  const token = new URL(req.url).searchParams.get("webhook_token") ?? "";
  return tokensEqual(token, secret);
}

// ─── PIX receiver — POST /payment/webhook/pix (D-10/D-13) ────────────────────

export async function receivePixWebhook(req: Request): Promise<Response> {
  if (!authorizeWebhook(req)) return unauthorized();

  // D-14 — raw bytes first: text() BEFORE JSON.parse.
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  // Body shapes Efí sends: {txid,...} (receiver) or {pix:[{txid,...}],...} — a
  // batch can carry MULTIPLE settled payments (parity service.py:238 iterates
  // every element of pix_list). Collect top-level + array, dedupe, process ALL.
  const pixEvents = Array.isArray(body.pix) ? (body.pix as Array<{ txid?: unknown }>) : [];
  const txids = [
    ...(typeof body.txid === "string" ? [body.txid] : []),
    ...pixEvents
      .map((e) => (typeof e.txid === "string" ? e.txid : ""))
      .filter((t) => t.length > 0),
  ];
  const uniqueTxids = [...new Set(txids)];
  if (uniqueTxids.length === 0) return json({ status: "ignored", reason: "no pix txid" });

  // D-13 — live re-query decides; the body is only a hint. WR-03 — EVERY
  // settled event is confirmed; a poisoned/expired txid must not abort the
  // batch (WR-02: 200 no-op per event, parity service.py:476-478).
  let processed = 0;
  for (const txid of uniqueTxids) {
    let live: PixChargeStatus;
    try {
      live = await getPixChargeStatus(txid);
    } catch {
      continue;
    }
    if (live.status !== "PAID") continue;
    await confirmPayment({
      providerChargeId: txid,
      family: "pix",
      // WR-04 — thread the settlement's end-to-end id (D-13: from the LIVE
      // re-query, never the body) so confirmPayment persists it (parity
      // service.py:271: pix_charge.end_to_end_id = pix_list[0].endToEndId).
      ...pixEndToEndId(live),
    });
    processed++;
  }
  return json({ status: "success", processed });
}

// ─── Card receiver — POST /payment/webhook/efipay (D-11/D-13) ────────────────

export async function receiveCardWebhook(req: Request): Promise<Response> {
  if (!authorizeWebhook(req)) return unauthorized();

  // D-14 — raw bytes first.
  const raw = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }

  // Card webhook body carries ONLY the notification token (routes.py:123-133).
  const notificationToken = typeof body.notification === "string" ? body.notification : "";
  if (!notificationToken) {
    return json({ status: "ignored", reason: "no notification token" });
  }

  // D-13 — get_notification round-trip (card-flow.md:365): the provider
  // charge id resolves from data[].identifiers.charge_id (service.py:485-486).
  let live: CardChargeStatus;
  try {
    live = await getCardChargeStatus(notificationToken);
  } catch {
    // WR-02 — ACK 200 no-op (parity service.py:476-478). The notification
    // token is only a sentinel: Efí re-notifies later, and the poll path
    // covers the buyer meanwhile.
    return json({ status: "success", processed: 0 });
  }
  if (!live.providerChargeId || live.status !== "PAID") {
    return json({ status: "success", processed: 0 });
  }

  await confirmPayment({ providerChargeId: live.providerChargeId, family: "card" });
  return json({ status: "success", processed: 1 });
}

// ─── WR-04 helpers ───────────────────────────────────────────────────────────

/**
 * WR-04 — safely extract pix[0].endToEndId from the LIVE re-query payload
 * (unknown shape — the charge body is provider-owned). Returns
 * { endToEndId } when present, {} otherwise (spread-friendly).
 */
function pixEndToEndId(live: PixChargeStatus): { endToEndId?: string } {
  const pix = (live.charge as { pix?: Array<{ endToEndId?: unknown }> } | undefined)?.pix;
  const value = pix?.[0]?.endToEndId;
  return typeof value === "string" && value.length > 0 ? { endToEndId: value } : {};
}