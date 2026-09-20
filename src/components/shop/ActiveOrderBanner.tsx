"use client";

// Active-reservation banner (Plan 30-06, ORDER-02 gate).
//
// Presentational: the page calls useActiveOrder() ONCE and passes the state
// down (single call site per page — plan task 3; each call site would fire its
// own mount fetch). Renders nothing when there is no live reservation
// (parity: success:false → silent no-op — zero behavioral change against the
// Phase 28 flows).
//
// When active: amber warning card (28-UI-SPEC alert conventions) with the
// Python-parity message (HasOrderResult.message verbatim), a live
// ReservationCountdown bound to expires_at_iso (30-01 additive), and a
// "Ver pedido" CTA to /pedidos/<uuid> when the redirect is /checkout/<uuid>
// (pix-unpaid / generic reservations). redirect "/" (card / paid-pix) → no CTA.

import React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import { ReservationCountdown } from "./ReservationCountdown";
import type { ActiveOrderState } from "./useActiveOrder";

export type ActiveOrderBannerProps = Pick<
  ActiveOrderState,
  "hasActive" | "message" | "expiresAt" | "orderUuid"
>;

const ActiveOrderBanner = ({
  hasActive,
  message,
  expiresAt,
  orderUuid,
}: ActiveOrderBannerProps) => {
  if (!hasActive) return null;

  return (
    <div
      role="status"
      className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 flex items-start gap-3"
    >
      <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0 space-y-3">
        <p className="text-sm text-amber-200">{message}</p>
        {expiresAt && (
          <div>
            <ReservationCountdown expiresAt={expiresAt} expired={false} />
          </div>
        )}
        {orderUuid && (
          <Link
            href={`/pedidos/${orderUuid}`}
            className="inline-flex items-center rounded-lg bg-amber-500/20 border border-amber-600/50 text-amber-100 text-sm font-medium px-3 py-1.5 hover:bg-amber-500/30 transition-colors"
          >
            Ver pedido
          </Link>
        )}
      </div>
    </div>
  );
};

export { ActiveOrderBanner };
