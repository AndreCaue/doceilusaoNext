"use client";

// Order detail view — Plan 30-07 (ORDER-03).
//
// Deep-linkable detail surface at /pedidos/[uuid], SPA-parity with
// Frontend/src/Pages/User/Orders/OrdersPage.tsx. Renders:
//   - header: short id + canonical OrdersStatusBadge + BRL total + dd/mm/yyyy
//   - expired PENDING banner (amber) OR ReservationCountdown (PENDING only)
//   - items with thumbnails (img when img_product, muted placeholder when null)
//   - totals block (freight discount row only when non-zero)
//   - shipping block (full address + recipient contact; "Sem endereço" fallback)
//   - payment block (method + payment-status labels, PT-BR)
//   - tracking block (D-04): read-only info + timeline gated on the
//     shipped/delivered sentinels; muted "Sem informações de rastreio" when null
//   - inert "Solicitar Devolução" button (D-06: refunds via support only)
//
// The page hands a SERIALIZED order (ISO date strings — no Date objects cross
// the Server→Client boundary; see SerializedOrderDetail below). expires_at is
// seconds-remaining from the query: the countdown receives the absolute ISO
// computed from Date.now() + expires_at.

import { useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { OrderDetailOrder } from "@/lib/orders/queries";
import { OrdersStatusBadge } from "./OrdersStatusBadge";
import { ReservationCountdown } from "./ReservationCountdown";

// ─── serialized wire shape ───────────────────────────────────────────────────

export type SerializedOrderDetailTracking = {
  tracking_code: string | null;
  tracking_url: string | null;
  shipping_company: string | null;
  shipping_status: string | null;
  status_label: string | null;
  status_updated_at: string | null; // ISO — serialized from Date
};

export type SerializedOrderDetail = Omit<
  OrderDetailOrder,
  "created_at" | "paid_at" | "tracking"
> & {
  created_at: string | null; // ISO
  paid_at: string | null; // ISO
  tracking: SerializedOrderDetailTracking | null;
};

// ─── formatting helpers (explicit, ICU-stable — parity with OrdersTable) ─────

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

/** Explicit dd/mm/yyyy — no toLocaleDateString (intl-dependent output would
 *  drift across ICU versions). Null/NaN → "—". */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function formatCEP(cep: string): string {
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
}

/** D-04 sentinel gate — timeline section only for shipped/delivered
 *  (schema stores lowercase VarChar(30); normalize defensively). */
function isTimelineWorthy(raw: string | null): boolean {
  const normalized = raw?.toLowerCase();
  return normalized === "shipped" || normalized === "delivered";
}

function paymentMethodLabel(method: string | null): string {
  if (method === "pix") return "PIX";
  if (method === "credit_card") return "Cartão de crédito";
  return method ?? "—";
}

function paymentStatusLabel(status: string | null): string {
  if (status === "PAID") return "Pago";
  if (status === "REFUNDED") return "Estornado";
  if (status === "PENDING") return "Aguardando pagamento";
  return status ?? "—";
}

// ─── component ───────────────────────────────────────────────────────────────

type OrderDetailProps = {
  order: SerializedOrderDetail;
};

const OrderDetail = ({ order }: OrderDetailProps) => {
  // WR-05 stable callback — the real app refreshes on expiry (banner on next
  // load); components using usure Router keep a stable ref. No-op keeps the
  // component dependency-free (testable without Next context).
  const handleExpired = useCallback(() => {}, []);

  return (
    <div className="space-y-6">
      {/* Header: short id + badge + total + date */}
      <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-slate-200 font-[Poppins]">
            Detalhes do pedido
          </h2>
          <p className="font-mono text-sm text-muted-foreground">{order.uuid}</p>
        </div>
        <OrdersStatusBadge status={order.status} />
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {formatDate(order.created_at)}
          </p>
          <p className="text-xl font-semibold text-slate-200">
            {formatBRL(order.total ?? 0)}
          </p>
        </div>
      </div>

      {/* Expired reservation — amber warning banner (never for paid orders:
          the query only flags PENDING past the reservation window) */}
      {order.expired && (
        <div className="rounded-xl border border-amber-700 bg-amber-950/40 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-200">
              Este pedido venceu por falta de pagamento
            </p>
            <Link
              href="/carrinho"
              className="mt-3 inline-flex h-9 items-center justify-center rounded-md bg-amber-500/90 px-4 text-sm font-medium text-amber-950 hover:bg-amber-500"
            >
              Iniciar novo checkout
            </Link>
          </div>
        </div>
      )}

      {/* Live reservation countdown — PENDING orders only */}
      {order.status === "PENDING" && !order.expired && (
        <ReservationCountdown
          expiresAt={
            order.expires_at !== null
              ? new Date(Date.now() + order.expires_at * 1000).toISOString()
              : null
          }
          expired={false}
          onExpired={handleExpired}
        />
      )}

      {/* Items with thumbnails */}
      <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-4">
          Itens do pedido
        </h3>
        <div className="space-y-4">
          {order.items.map((item, idx) => (
            <div key={idx} className="flex gap-3">
              <div className="relative h-16 w-16 rounded-md overflow-hidden bg-slate-800 flex-shrink-0">
                {item.img_product ? (
                  <Image
                    src={item.img_product}
                    alt={item.product_name}
                    width={64}
                    height={64}
                    className="object-cover h-full w-full"
                    unoptimized
                  />
                ) : (
                  <div
                    className="h-full w-full bg-slate-700 flex items-center justify-center text-xs text-muted-foreground"
                    data-testid="item-no-image"
                  >
                    &#128247;
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-200 truncate">
                  {item.product_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {item.quantity}x {formatBRL(item.unit_price)}
                </p>
              </div>
              <p className="text-sm font-semibold text-slate-200 flex-shrink-0">
                {formatBRL(item.total_price)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Shipping address + recipient contact */}
      {order.shipping_full ? (
        <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
          <h3 className="text-base font-semibold text-slate-200 mb-3">
            Endereço de entrega
          </h3>
          <div className="text-sm text-slate-300 space-y-1">
            <p className="font-medium text-slate-200">
              {order.shipping_full.recipient_name}
            </p>
            <p>{order.shipping_full.recipient_document}</p>
            <p>
              {order.shipping_full.street}, {order.shipping_full.number}
              {order.shipping_full.complement
                ? ` — ${order.shipping_full.complement}`
                : ""}
            </p>
            <p>{order.shipping_full.neighborhood}</p>
            <p>
              {order.shipping_full.city} — {order.shipping_full.state}
            </p>
            <p>CEP: {formatCEP(order.shipping_full.postal_code)}</p>
            <Separator className="my-3" />
            <p className="text-muted-foreground">
              {order.shipping_full.recipient_phone}
            </p>
            <p className="text-muted-foreground">
              {order.shipping_full.recipient_email}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
          <h3 className="text-base font-semibold text-slate-200 mb-3">
            Endereço de entrega
          </h3>
          <p className="text-sm text-muted-foreground">Sem endereço</p>
        </div>
      )}

      {/* Totals */}
      <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-3">
          Resumo do pedido
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="text-slate-200">
              {formatBRL(order.subtotal ?? 0)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Frete</span>
            <span className="text-slate-200">
              {formatBRL(order.shipping_cost)}
            </span>
          </div>
          {order.shipping_discount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desconto no frete</span>
              <span className="text-green-400">
                -{formatBRL(order.shipping_discount)}
              </span>
            </div>
          )}
          <Separator className="my-2" />
          <div className="flex justify-between items-center">
            <span className="text-base font-semibold text-slate-200">
              Total
            </span>
            <span className="text-base font-semibold text-slate-200">
              {formatBRL(order.total ?? 0)}
            </span>
          </div>
        </div>
      </div>

      {/* Payment */}
      <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-3">
          Pagamento
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Método</span>
            <span className="text-slate-200">
              {paymentMethodLabel(order.payment_method)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="text-slate-200">
              {paymentStatusLabel(order.payment_status)}
            </span>
          </div>
        </div>
      </div>

      {/* Tracking (D-04: inert info surface, timeline on shipped/delivered) */}
      <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
        <h3 className="text-base font-semibold text-slate-200 mb-3">
          Rastreio
        </h3>
        {order.tracking ? (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Código</span>
              <span className="font-mono text-slate-200">
                {order.tracking.tracking_code ?? "—"}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Transportadora</span>
              <span className="text-slate-200">
                {order.tracking.shipping_company ?? "—"}
              </span>
            </div>
            {order.tracking.tracking_url && (
              <a
                href={order.tracking.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300"
              >
                Acompanhar entrega
              </a>
            )}
            {isTimelineWorthy(order.tracking.shipping_status) ? (
              <div
                className="mt-2 rounded-lg bg-neutral-800/60 p-3 space-y-2"
                data-testid="tracking-timeline"
              >
                <p className="text-sm text-slate-200">
                  {order.tracking.status_label ?? "—"} —{" "}
                  {formatDate(order.tracking.status_updated_at)}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                Status: {order.tracking.status_label ?? "—"} · Atualizado:{" "}
                {formatDate(order.tracking.status_updated_at)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sem informações de rastreio
          </p>
        )}
      </div>

      {/* Inert refund surface (D-06: reimbursements only via support) */}
      <button
        type="button"
        aria-disabled="true"
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-none inline-flex h-9 items-center justify-center rounded-md border border-white/10 px-4 text-sm text-muted-foreground opacity-70"
      >
        Solicitar Devolução
      </button>
    </div>
  );
};

export { OrderDetail };