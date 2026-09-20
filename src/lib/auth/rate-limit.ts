// Per-route in-memory sliding-window rate limiter — port of the SlowAPI
// per-route decorators (Backend/app/auth/routes.py) for coexistence parity
// (26-CONTEXT D-08 + migration doc "rate-limiter ported per-route").
//
// Limits (events per 60s window — backend per-minute parity):
//   register 5/min, verify 5/min, resend-verification 3/min,
//   token (login) 10/min, forgot-password 3/min, reset-password 3/min.
//
// ⚠️ PER-INSTANCE ONLY: state lives in a module-level Map, so a multi-instance
// deployment would enforce each instance's budget independently. This limiter
// exists for dev/coexistence parity — production multi-instance rate limiting
// is Phase 31 Upstash Redis (INFRA-03). Do NOT build Redis semantics here.
//
// Key contract: callers pass a free-form string, conventionally
// `${route}:${ip}` — route handlers extract the IP from
// `req.headers.get("x-forwarded-for")` (first entry) or `"local"`.
//
// Threat T-26-02-03 (mitigate): unbounded memory is guarded by pruning expired
// entries on every access — each key holds at most `max` timestamps. NOTE: this
// prunes per-key timestamps only; the KEY COUNT itself is never pruned. Because
// `ip()` sources x-forwarded-for (client-settable), an attacker rotating XFF
// values can grow the `hits` Map without bound (the pruning only runs when an
// existing key is re-accessed). Accepted for v1 (Phase 31 Redis limiter is the
// hardening) — captured as a Phase 31 work item (IN-05).
// Threat T-26-02-04 (accepted): x-forwarded-for is client-settable; this is
// per-route abatement, not a security boundary — the Phase 31 Redis limiter is
// the hardening.

export const RATE_LIMITS = {
  register: 5,
  verify: 5,
  "resend-verification": 3,
  token: 10,
  "forgot-password": 3,
  "reset-password": 3,
} as const;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

const DEFAULT_WINDOW_MS = 60_000;

/** Sliding-window hit timestamps per key — pruned on every access (T-26-02-03). */
const hits = new Map<string, number[]>();

/**
 * Record one event for `key` within `windowMs`.
 *
 * On success: `{ ok: true }` (event counted). On exceed: `{ ok: false,
 * retryAfterSeconds }` — route handlers map that to a 429 with the D-12 shape
 * `{ error: "Muitas tentativas. Tente novamente em instantes.", code:
 * "RATE_LIMITED", retryable: true }`.
 */
export function rateLimit(key: string, max: number, windowMs: number = DEFAULT_WINDOW_MS): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Prune expired timestamps and re-persist the trimmed window.
  const active = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

  if (active.length >= max) {
    hits.set(key, active);
    // The oldest still-active hit frees a slot at `oldest + windowMs`.
    const oldest = active[0];
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }

  active.push(now);
  hits.set(key, active);
  return { ok: true };
}