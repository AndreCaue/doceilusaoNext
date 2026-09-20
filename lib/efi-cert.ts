// Efí .p12 client-certificate pipeline (FOUND-06, D-13/D-14/D-15/D-16).
//
// SERVER-ONLY module — never import from a client component or a route that
// serializes its exports to the browser. `getEfiAgent` holds the decoded p12
// in an https.Agent; exposing it to the client would leak the private key
// (T-25-03). Route handlers must consume this module on the server side only
// (import relative from any route handler, e.g. `../../../lib/efi-cert`).
//
// Lazy by design: NO env var is read at import time, so `next build` and
// unrelated routes never throw while EFI_* is absent. The p12 decode happens
// on first `getEfiAgent()` call and is cached as a singleton for the process
// lifetime (D-13 startup-decode pattern, deferred to first use).
//
// Env contract (from .env.example, FOUND-05):
//   EFI_CERTIFICATE_BASE64  base64 of the project's .p12 (server-only, never NEXT_PUBLIC_)
//   EFI_CERT_PASSPHRASE     .p12 export passphrase, SEPARATE var (D-14)
//   EFI_SANDBOX             "true"/"1" → sandbox host + bypass header (D-15)
//
// OpenSSL 3.x landmine: if createSecureContext throws ERR_OSSL_PKCS12_PBE_CRYPT /
// "unsupported" (legacy PBE ciphers), remediate by re-encoding the .p12 with
// modern ciphers (see scripts/verify-efi-cert.mjs header). NEVER set
// NODE_TLS_REJECT_UNAUTHORIZED=0 — rejectUnauthorized stays true (T-25-07).

import https from "node:https";

// ─── Sandbox/production config contract ─────────────────────────
export type EfiSandboxConfig = {
  sandbox: boolean;
  baseUrl: string;
  /** Extra headers for Efí calls (sandbox bypass header in sandbox mode). */
  extraHeaders: Record<string, string>;
};

// Efí PIX API hosts — mirrors the Python backend (efipay SDK constants +
// hardcoded `# sandbox` URLs in Backend/app/payment/efi_client.py).
const EFI_PIX_PRODUCTION_URL = "https://pix.api.efipay.com.br";
const EFI_PIX_SANDBOX_URL = "https://pix-h.api.efipay.com.br";

// Sandbox bypass header — exact header the Python backend sends today
// (Backend/app/payment/webhook/setup_webhook.py:14 and service.py:312:
// `{"x-skip-mtls-checking": "true"}`). D-15's "x-skip-matches-checking" is a typo.
const EFI_SANDBOX_BYPASS_HEADER = "x-skip-mtls-checking";

// ─── Lazy singleton agent ───────────────────────────────────────
let cachedAgent: https.Agent | undefined;

/**
 * Startup decode (D-13): reads EFI_CERTIFICATE_BASE64, base64-decodes it to a
 * Buffer, and reads EFI_CERT_PASSPHRASE. Errors name ONLY the missing var
 * names — secret values are never included in messages (T-25-04).
 */
export function loadEfiCertificate(): { pfx: Buffer; passphrase: string } {
  const base64 = process.env.EFI_CERTIFICATE_BASE64;
  const passphrase = process.env.EFI_CERT_PASSPHRASE;

  if (!base64 || !passphrase) {
    const missing: string[] = [];
    if (!base64) missing.push("EFI_CERTIFICATE_BASE64");
    if (!passphrase) missing.push("EFI_CERT_PASSPHRASE");
    throw new Error(`${missing.join("/")} não configurados`);
  }

  return { pfx: Buffer.from(base64, "base64"), passphrase };
}

/**
 * Lazy singleton https.Agent for Efí mTLS calls (D-13). The p12 decodes once
 * on first use and is cached for the process lifetime. `rejectUnauthorized`
 * is hardcoded true (T-25-07) — NODE_TLS_REJECT_UNAUTHORIZED is never read.
 */
export function getEfiAgent(): https.Agent {
  if (cachedAgent) return cachedAgent;

  const { pfx, passphrase } = loadEfiCertificate();
  cachedAgent = new https.Agent({ pfx, passphrase, rejectUnauthorized: true });

  return cachedAgent;
}

/**
 * Sandbox vs production config (D-15). Sandbox is controlled by EFI_SANDBOX
 * ("true"/"1", case-insensitive) and mirrors the Python backend: sandbox host
 * + x-skip-mtls-checking bypass header. Phase 29 consumers call
 * `getEfiSandboxConfig().extraHeaders` instead of hardcoding the header.
 */
export function getEfiSandboxConfig(): EfiSandboxConfig {
  const sandbox = /^(true|1)$/i.test(process.env.EFI_SANDBOX ?? "");

  if (sandbox) {
    return {
      sandbox: true,
      baseUrl: EFI_PIX_SANDBOX_URL,
      extraHeaders: { [EFI_SANDBOX_BYPASS_HEADER]: "true" },
    };
  }

  return {
    sandbox: false,
    baseUrl: EFI_PIX_PRODUCTION_URL,
    extraHeaders: {},
  };
}