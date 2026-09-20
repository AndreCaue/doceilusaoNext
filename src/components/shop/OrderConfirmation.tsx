"use client";

// Order confirmation client component — displays after successful checkout.
// Shows order items, shipping info, totals, reservation countdown, and a
// payment placeholder (Phase 29 boundary). Expired state renders a destructive
// alert with redirect CTA per UI-SPEC.
//
// Props are serialized from the Server Component (no Date objects).

import React from "react";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ReservationCountdown } from "./ReservationCountdown";
import { PaymentTabs } from "./payments/PaymentTabs";

// Serialized order shape matching what the Server Component passes after
// stripping Prisma Date objects and non-serializable fields.
export type SerializedOrderItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  img_product: string | null;
};

export type SerializedOrderShipping = {
  recipient_name: string;
  /** Cardholder CPF — consumed by the payment panels (D-20 holderDocument). */
  recipient_document: string | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
} | null;

export type SerializedOrder = {
  uuid: string;
  status: string | null;
  payment_status: string | null;
  reservation_expires_at: string | null;
  subtotal: number | null;
  total: number | null;
  shipping_carrier: string;
  shipping_method: string;
  shipping_cost: number;
  shipping_original: number;
  shipping_delivery_days: number;
  created_at: string | null;
  items: SerializedOrderItem[];
  shipping: SerializedOrderShipping;
};

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const formatCEP = (cep: string) =>
  cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;

type OrderConfirmationProps = {
  order: SerializedOrder;
  expired: boolean;
};

const OrderConfirmation = ({ order, expired }: OrderConfirmationProps) => {
  const router = useRouter();
  // Stable callback — prevents ReservationCountdown's interval effect from
  // re-running on every parent render (WR-05)
  const handleExpired = useCallback(() => router.refresh(), [router]);

  return (
    <div className="space-y-6">
      {/* Decorative purple/fuchsia glow flourish (UI-SPEC shipped pattern) */}
      <div className="text-center mb-8">
        <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-purple-600/20 to-fuchsia-600/10 flex items-center justify-center mb-4">
          <span className="text-4xl">&#10003;</span>
        </div>
        <h2 className="text-2xl font-semibold text-slate-200 font-[Poppins]">
          Pedido confirmado
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Pedido <span className="font-mono text-slate-300">{order.uuid}</span>
        </p>
      </div>

      {/* Reservation countdown (CHECKOUT-03) */}
      <ReservationCountdown
        expiresAt={order.reservation_expires_at}
        expired={expired}
        onExpired={handleExpired}
      />

      {/* Expired alert — destructive banner per UI-SPEC */}
      {expired && (
        <div className="rounded-xl border border-red-800 bg-red-950/50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-red-200">
              O prazo de reserva deste pedido expirou. Inicie um novo checkout.
            </p>
            <Button
              variant="destructive"
              className="mt-3 h-9"
              onClick={() => router.push("/carrinho")}
            >
              Iniciar novo checkout
            </Button>
          </div>
        </div>
      )}

      {/* Order items */}
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
                    fill
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="h-full w-full bg-slate-700 flex items-center justify-center text-xs text-muted-foreground">
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

      {/* Shipping info */}
      {order.shipping && (
        <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
          <h3 className="text-base font-semibold text-slate-200 mb-3">
            Entrega
          </h3>
          <div className="text-sm text-slate-300 space-y-1">
            <p>{order.shipping.recipient_name}</p>
            <p>
              {order.shipping.street}, {order.shipping.number}
              {order.shipping.neighborhood &&
                ` — ${order.shipping.neighborhood}`}
            </p>
            <p>
              {order.shipping.city} — {order.shipping.state}
            </p>
            <p>CEP: {formatCEP(order.shipping.postal_code)}</p>
            <Separator className="my-3" />
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                {order.shipping_carrier} — {order.shipping_method}
              </span>
              <span className="text-muted-foreground">
                {order.shipping_delivery_days} dias úteis
              </span>
            </div>
          </div>
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

      {/* Payment collection surface (Plan 29-05) — parity Frontend
          PixPayment/CardPayment; ReservationCountdown renders above.
          WR-06 — never render live payment forms for an expired reservation:
          createPixCharge rejects (D-08) and createCardOneStep now rejects too
          (WR-06 server parity). An already-PAID order still renders its
          confirmation surface (e.g. post-payment refresh). */}
      {(!expired || order.payment_status === "PAID") && (
        <PaymentTabs order={order} />
      )}
    </div>
  );
};

export { OrderConfirmation };
