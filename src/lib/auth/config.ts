// Auth configuration — server-side env contract (Phase 26, shared-SECRET_KEY parity).
//
// Mirrors `Backend/app/core/config.py` auth portion:
//   * SECRET_KEY -> AUTH_SECRET (fallback chain mirrors admin-proxy.ts:25)
//   * ALGORITHM  -> "HS256" (fixed, backend parity)
//   * ACCESS_TOKEN_EXPIRE_MINUTES -> 30 default
//   * ENVIRONMENT -> isProduction derived from NODE_ENV (routes.py:243 parity —
//     `settings.ENVIRONMENT == 'production'` branches on the deployment env)
//
// The secret is read LAZILY: importing this module never crashes (tsc/builds of
// pages that only import types are safe), but functions that actually need the
// secret call `requireAuthSecret()` and throw SERVER_MISCONFIGURED at call time
// (Threat T-26-01-01 — secret never bundled, never logged).

export const ACCESS_TOKEN_EXPIRE_MINUTES = (() => {
  const raw = process.env.ACCESS_TOKEN_EXPIRE_MINUTES ?? "30";
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 30 : parsed;
})();

export const isProduction = process.env.NODE_ENV === "production";

/** Shared JWT signing key — MUST match Backend/.env SECRET_KEY (D-02, D-11). */
export const AUTH_SECRET = process.env.SECRET_KEY ?? process.env.AUTH_SECRET;

/** Production cookie domain — D-03 parity with routes.py:250 (`domain='.doceilusao.store'`). */
export const PROD_COOKIE_DOMAIN = ".doceilusao.store";

export const AUTH_CONFIG = {
  algorithm: "HS256" as const,
  accessTokenExpireMinutes: ACCESS_TOKEN_EXPIRE_MINUTES,
  isProduction,
  prodCookieDomain: PROD_COOKIE_DOMAIN,
  // Refresh TTL parity: backend mint/refresh routes use timedelta(days=30).
  refreshTokenExpireSeconds: 60 * 60 * 24 * 30,
  // Reset TTL parity: backend jwt.py create_reset_password_token uses 30 minutes.
  resetTokenExpireMinutes: 30,
};

/** Lay accessor — throws only when a caller actually needs the signing secret. */
export function requireAuthSecret(): string {
  if (!AUTH_SECRET) {
    throw new Error(
      "SERVER_MISCONFIGURED: SECRET_KEY (ou AUTH_SECRET) não configurado — copie o valor de Backend/.env para doceilusao-next/.env.local",
    );
  }
  return AUTH_SECRET;
}