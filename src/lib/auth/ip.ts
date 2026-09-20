// Shared client-IP extraction for route handlers — rate-limit.ts key contract:
// `${route}:${ip}`, first x-forwarded-for entry, or "local" (T-26-02-04:
// x-forwarded-for is client-settable; this is per-route abatement, not a
// security boundary — the Phase 31 Redis limiter is the hardening).
//
// Single source of truth so a contract change (e.g. parsing x-real-ip) updates
// one module instead of six in lockstep (IN-04).

import type { NextRequest } from "next/server";

/** First x-forwarded-for entry, or "local" when absent/empty. */
export function ip(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return "local";
}