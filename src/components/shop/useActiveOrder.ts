"use client";

// useActiveOrder — the ORDER-02 "one reservation at a time" gate hook
// (Plan 30-06).
//
// Consumes GET /api/orders/by-user (30-03) on mount — the HasOrderResult wire
// shape from the 30-01 read layer — and derives the banner state:
//
//   hasActive = data.success                       (server-provided boolean)
//   message   = data.message   (Python parity text, verbatim)
//   expiresAt = data.expires_at_iso                (30-01 additive ISO)
//   orderUuid = redirect startsWith /checkout/ ? the uuid segment : null
//
// Derivation rule (T-30-06-02): the server is the ONLY source of truth for the
// reservation boolean + redirect; the client only derives DISPLAY fields
// (orderUuid from the redirect path) — no client-supplied authorization data.
//
// Fail-open availability (T-30-06-03): any fetch failure → inactive state, the
// banner stays absent. The invariant is still SERVER-enforced (30-06 task 3:
// POST /api/checkout → 409 ACTIVE_RESERVATION while a reservation is live) —
// the UI gate is cosmetic, never authoritative.

import { useEffect, useState } from "react";

import type { HasOrderResult } from "@/lib/orders/queries";

export type ActiveOrderState = {
  hasActive: boolean;
  message: string;
  expiresAt: string | null;
  orderUuid: string | null;
  loading: boolean;
};

const INACTIVE: ActiveOrderState = {
  hasActive: false,
  message: "",
  expiresAt: null,
  orderUuid: null,
  loading: false,
};

const INITIAL: ActiveOrderState = {
  ...INACTIVE,
  loading: true,
};

export function useActiveOrder(): ActiveOrderState {
  const [state, setState] = useState<ActiveOrderState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/orders/by-user", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: HasOrderResult | null) => {
        if (cancelled) return;
        if (!data?.success) {
          // NO_ORDER parity (routes.py:88) — no reservation → silent no-op.
          setState(INACTIVE);
          return;
        }
        const redirect = data.redirect ?? null;
        const orderUuid = redirect?.startsWith("/checkout/")
          ? redirect.slice("/checkout/".length)
          : null;
        setState({
          hasActive: true,
          message: data.message,
          expiresAt: data.expires_at_iso,
          orderUuid,
          loading: false,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Fail-open availability: no banner — the server 409 gate still
        // protects the invariant for direct POSTs.
        setState(INACTIVE);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}