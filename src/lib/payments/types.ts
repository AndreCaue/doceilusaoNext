// Efí transport types (Plan 29-01 — consumed by plans 29-02..29-06).
//
// Parity: Backend/app/payment/efi_client.py + service.py error shape (D-12),
// host map per family (D-06), OAuth result contract (D-04).

export type EfiError = { error: string; code: string; retryable: boolean };

export type EfiFamily = "pix" | "cobrancas";

/** Per-family base hosts (D-06) — sandbox and production sets. */
export type EfiHostMap = { pix: string; cobrancas: string };

/** Efí OAuth token endpoint response (grant_type=client_credentials). */
export type EfiOAuthResult = { access_token: string; expires_in: number };