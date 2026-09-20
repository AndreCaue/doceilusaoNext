// Prisma-direct order read layer — Phase 30 contract (Plan 30-01).
//
// The three reads mirror the Python `Backend/app/store/orders/routes.py` +
// `schemas.py` response contracts EXACTLY (SPA-parity), plus the additive
// fields the Next detail page needs (30-01 <interfaces> block):
//
//   - listOrdersByUser        → OrderListItemOut parity, created_at DESC
//   - getActiveReservation    → HasOrderDetail parity; NEVER errors — any DB
//                               exception degrades to NO_ORDER (routes.py:88
//                               "Nunca retorna erro"). Message-variant check
//                               order MATTERS: card → pix-paid → pix-unpaid →
//                               generic (routes.py:58-86).
//   - getOrderDetailForUser   → OrderDetailOut parity + additives, owner-scoped
//                               (unknown → not_found; other user → forbidden);
//                               expired flag = 410-GONE parity (routes.py:188-193).
//
// All reads are Prisma-direct. NO writes, NO proxy traffic, NO stale-cache
// layer (research/PITFALLS.md L417 — fresh Server-Component reads).
//
// The Prisma client exposes the schema's snake_case field names and returns
// enum values UPPERCASE ("PENDING", "PAID"...) — never translate those to the
// Python lowercase strings; consumers compare against the Prisma enum values.

import { prisma } from "@/lib/prisma";

// ─── Public contracts (consumers: plans 30-03 routes, 30-04 history, 30-07 detail) ─

export type OrderListItem = {
  id: string;
  short_id: string;
  status: string | null;
  total: number | null;
  created_at: Date | null;
  items: { name: string; qty: number; price: number; order_item_id: number }[];
  shipping_carrier: string;
  payment_method: string | null;
  recipient_name: string | null;
};

export type HasOrderResult = {
  success: boolean;
  message: string;
  redirect: string | null;
  expires_at: number;
  expires_at_iso: string | null;
};

export type OrderDetailResultKind = "not_found" | "forbidden" | "ok";

export type OrderDetailItem = {
  product_id: number;
  quantity: number;
  unit_price: number;
  total_price: number;
  img_product: string | null;
  product_name: string;
};

export type OrderDetailShipping = {
  recipient_name: string;
  recipient_document: string;
  recipient_phone: string;
  recipient_email: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
};

export type OrderDetailTracking = {
  tracking_code: string | null;
  tracking_url: string | null;
  shipping_company: string | null;
  shipping_status: string | null;
  status_label: string | null;
  status_updated_at: Date | null;
};

export type OrderDetailOrder = {
  id: string;
  uuid: string;
  // additive: Prisma UPPERCASE order status — consumed by the detail badge
  // (OrdersStatusBadge) and the PENDING countdown gate (30-07 plan interface;
  // the 30-01 implementation omitted it, add it here for full contract).
  status: string | null;
  payment_status: string | null;
  subtotal: number | null;
  shipping_method: string;
  shipping_carrier: string;
  shipping_cost: number;
  shipping_discount: number;
  shipping_original: number;
  shipping_delivery_days: number;
  expires_at: number | null;
  total: number | null;
  user: { recipient_name: string; recipient_document: string } | null;
  items: OrderDetailItem[];
  // ── Next additives (detail page needs) ──
  payment_method: string | null;
  paid_at: Date | null;
  created_at: Date | null;
  shipping_full: OrderDetailShipping | null;
  tracking: OrderDetailTracking | null;
  expired: boolean;
};

export type OrderDetailResult =
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "ok"; order: OrderDetailOrder };

const NO_ORDER: HasOrderResult = {
  success: false,
  message: "",
  redirect: null,
  expires_at: 0,
  expires_at_iso: null,
};

function shortId(uuid: string): string {
  return `P-${uuid.slice(0, 5).toUpperCase()}`;
}

/** Python int() truncation parity for seconds-remaining (routes.py:55). */
function secondsRemaining(expiresAt: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
}

// ─── listOrdersByUser ───────────────────────────────────────────────────────

export async function listOrdersByUser(userId: number): Promise<OrderListItem[]> {
  const orders = await prisma.order.findMany({
    where: { user_id: userId },
    include: { items: true, shipping: true },
    orderBy: { created_at: "desc" }, // routes.py:116 parity
  });

  return orders.map((order) => ({
    id: order.uuid,
    short_id: shortId(order.uuid),
    status: order.status,
    total: order.total,
    created_at: order.created_at,
    items: order.items.map((item) => ({
      name: item.product_name,
      qty: item.quantity,
      price: item.unit_price,
      order_item_id: item.id,
    })),
    shipping_carrier: order.shipping_carrier,
    payment_method: order.payment_method,
    recipient_name: order.shipping ? order.shipping.recipient_name : null,
  }));
}

// ─── getActiveReservation ───────────────────────────────────────────────────

export async function getActiveReservation(userId: number): Promise<HasOrderResult> {
  try {
    const order = await prisma.order.findFirst({
      where: { user_id: userId, reservation_expires_at: { gt: new Date() } },
    });

    if (!order) return NO_ORDER;

    const expiresAt = order.reservation_expires_at;
    const expires_in_seconds = expiresAt ? secondsRemaining(expiresAt) : 0;
    const expires_at_iso = expiresAt ? expiresAt.toISOString() : null;
    const short_uuid = shortId(order.uuid);

    // Check order matters (routes.py:58-86): card → pix-paid → pix-unpaid → generic.
    if (order.efipay_charge_card_id) {
      return {
        success: true,
        message: `Pedido aguardando pagamento ou já pago, aguarde o tempo para realizar outra compra! Pedido Nº #${short_uuid}`,
        redirect: "/",
        expires_at: expires_in_seconds,
        expires_at_iso,
      };
    }

    if (order.efipay_charge_pix_id) {
      if (order.paid_at || order.payment_status === "PAID") {
        return {
          success: true,
          message: `Pedido pago via PIX, aguarde o tempo para realizar outra compra! Pedido Nº #${short_uuid}`,
          redirect: "/",
          expires_at: expires_in_seconds,
          expires_at_iso,
        };
      }
      return {
        success: true,
        message: `Pedido aguardando pagamento. Se já realizou o pagamento, ignore e aguarde. Pedido Nº #${short_uuid}`,
        redirect: `/checkout/${order.uuid}`,
        expires_at: expires_in_seconds,
        expires_at_iso,
      };
    }

    return {
      success: true,
      message: `Pedido Nº #${short_uuid} — finalize o pagamento ou aguarde o tempo para realizar outra compra!`,
      redirect: `/checkout/${order.uuid}`,
      expires_at: expires_in_seconds,
      expires_at_iso,
    };
  } catch {
    // routes.py:88 "Nunca retorna erro" — any DB failure degrades to NO_ORDER.
    return NO_ORDER;
  }
}

// ─── getOrderDetailForUser ──────────────────────────────────────────────────

export async function getOrderDetailForUser(
  orderUuid: string,
  userId: number,
): Promise<OrderDetailResult> {
  const order = await prisma.order.findFirst({
    where: { uuid: orderUuid },
    include: {
      items: true,
      shipping: true,
      shipments: { include: { status_history: { orderBy: { created_at: "desc" } } } },
    },
  });

  if (!order) return { kind: "not_found" };
  if (order.user_id !== userId) return { kind: "forbidden" }; // D-07: 403 ≠ 404

  const reservation = order.reservation_expires_at;
  const expires_at = reservation ? secondsRemaining(reservation) : null;

  // 410-GONE parity (routes.py:188-193): only PENDING orders past their
  // reservation are "expired" — paid/confirmed/shipped never are.
  const expired =
    reservation !== null &&
    reservation.getTime() < Date.now() &&
    order.status === "PENDING";

  // Tracking block is null unless a shipment carries tracking data (D-04 —
  // render gating on shipped/delivered is the component's job).
  const trackingShipment = order.shipments.find(
    (shipment) => shipment.tracking_code !== null || shipment.tracking_url !== null,
  );
  const tracking: OrderDetailTracking | null = trackingShipment
    ? {
        tracking_code: trackingShipment.tracking_code,
        tracking_url: trackingShipment.tracking_url,
        shipping_company: trackingShipment.shipping_company,
        shipping_status: trackingShipment.shipping_status,
        status_label: trackingShipment.status_history[0]?.melhorenvio_status_label ?? null,
        status_updated_at: trackingShipment.status_history[0]?.created_at ?? null,
      }
    : null;

  const shipping = order.shipping;

  return {
    kind: "ok",
    order: {
      id: order.uuid,
      uuid: shortId(order.uuid),
      status: order.status,
      payment_status: order.payment_status,
      subtotal: order.subtotal,
      shipping_method: order.shipping_method,
      shipping_carrier: order.shipping_carrier,
      shipping_cost: order.shipping_cost,
      shipping_discount: order.shipping_discount ?? 0, // 0 fallback parity
      shipping_original: order.shipping_original,
      shipping_delivery_days: order.shipping_delivery_days,
      expires_at,
      total: order.total,
      user: shipping
        ? {
            recipient_name: shipping.recipient_name,
            recipient_document: shipping.recipient_document,
          }
        : null,
      items: order.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        img_product: item.img_product,
        product_name: item.product_name,
      })),
      payment_method: order.payment_method,
      paid_at: order.paid_at,
      created_at: order.created_at,
      shipping_full: shipping
        ? {
            recipient_name: shipping.recipient_name,
            recipient_document: shipping.recipient_document,
            recipient_phone: shipping.recipient_phone,
            recipient_email: shipping.recipient_email,
            street: shipping.street,
            number: shipping.number,
            complement: shipping.complement,
            neighborhood: shipping.neighborhood,
            city: shipping.city,
            state: shipping.state,
            postal_code: shipping.postal_code,
          }
        : null,
      tracking,
      expired,
    },
  };
}