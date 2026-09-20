// Efí transport client (Plan 29-01 — foundation for plans 29-02..29-06).
//
// SERVER-ONLY module — never import from a client component. `getEfiAgent()`
// holds the decoded p12 private key (T-25-03 / D-05).
//
// Parity (29-CONTEXT D-01..D-06, D-12, D-15; 29-RESEARCH §1; Python
// `Backend/app/payment/efi_client.py` + `service.py`):
//   - D-04: OAuth `grant_type=client_credentials` via https.request + mTLS
//     agent (undici/fetch silently drops https.Agent — must NOT use fetch).
//     Token cached in-process with TTL = expires_in - 60s margin; a second
//     authorize() within TTL never hits the network.
//   - D-06: one host per family — PIX `pix(+h).api.efipay.com.br`,
//     CHARGES (cobranças) `cobrancas(+h).api.efipay.com.br`.
//   - D-12: non-2xx → `{ error, code, retryable }` PT-BR; never surface raw
//     client_id / client_secret / access_token in messages (T-25-03).
//   - D-15: sandbox bypass header comes from getEfiSandboxConfig().extraHeaders
//     (single source — never hardcoded); production requests carry none.
//   - D-01: mTLS on ALL Efí calls (superset of Python — CHARGES calls used
//     Basic-only; Efí ignores the unneeded client cert).

import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import { getEfiAgent, getEfiSandboxConfig } from "../../../lib/efi-cert";
import type { EfiError, EfiFamily, EfiHostMap, EfiOAuthResult } from "./types";

// ─── Host map per family (D-06 — parity Python efipay constants/endpoints) ──
const EFI_HOSTS: EfiHostMap = {
  pix: "https://pix.api.efipay.com.br",
  cobrancas: "https://cobrancas.api.efipay.com.br",
};

const EFI_SANDBOX_HOSTS: EfiHostMap = {
  pix: "https://pix-h.api.efipay.com.br",
  cobrancas: "https://cobrancas-h.api.efipay.com.br",
};

const OAUTH_PATH = "/v2/oauth/token";

/** D-04 — refresh at `expires_in - OAUTH_TTL_MARGIN_SECONDS` (Efí default 28 min). */
const OAUTH_TTL_MARGIN_SECONDS = 60;

let tokenCache: { token: string; expiresAt: number } | undefined;

/**
 * OAuth client_credentials (D-04): Basic base64(client_id:client_secret) →
 * POST {pixHost}/v2/oauth/token with the mTLS agent + sandbox bypass headers.
 * Returns the bearer token, cached until `expires_in - 60s`; a call within the
 * TTL returns the cached token with NO network round-trip.
 */
export async function authorize(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const clientId = process.env.EFI_CLIENT_ID;
  const clientSecret = process.env.EFI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw efiError("Credenciais Efí não configuradas", "EFI_UNAUTHORIZED", false);
  }

  const cfg = getEfiSandboxConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const result = await requestJson<EfiOAuthResult>(
    `${cfg.baseUrl}${OAUTH_PATH}`,
    {
      method: "POST",
      agent: getEfiAgent(),
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...cfg.extraHeaders,
      },
    },
    "grant_type=client_credentials",
  );

  tokenCache = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(0, result.expires_in - OAUTH_TTL_MARGIN_SECONDS) * 1000,
  };

  return tokenCache.token;
}

/**
 * Low-level Efí request wrapper (D-06 host map + D-04 Bearer + D-12 errors).
 * Route handlers in plans 29-02..29-06 call this with a family + path; the
 * family selects the sandbox/prod host per D-06 (parity Python SDK constants).
 */
export async function efiRequest<T = unknown>(opts: {
  family: EfiFamily;
  path: string;
  method?: "POST" | "GET";
  body?: Record<string, unknown>;
}): Promise<T> {
  const cfg = getEfiSandboxConfig();
  const hosts = cfg.sandbox ? EFI_SANDBOX_HOSTS : EFI_HOSTS;
  const isSandbox = cfg.sandbox;

  const token = await authorize();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  // D-15 / K-01 — sandbox bypass headers ONLY in sandbox (single source from
  // getEfiSandboxConfig().extraHeaders; production strips them entirely).
  if (isSandbox) {
    Object.assign(headers, cfg.extraHeaders);
  }

  return requestJson<T>(
    `${hosts[opts.family]}${opts.path}`,
    {
      method: opts.method ?? "POST",
      agent: getEfiAgent(),
      headers,
    },
    opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  );
}

/**
 * Efí card charge detail lookup (Plan 30-02 — ORDER-04 refund liveness,
 * parity `Backend/app/payment/service.py` get_card_charge_details).
 *
 * Normalizes the REAL Efí detail shape: upstream Python
 * `details.get("status") != "paid"` breaks because Efí returns `status` as an
 * OBJECT `{ current: "paid" }` — the Python guard always rejected object
 * statuses. Here object status → `status.current`, scalar status → as-is,
 * ARRAY `data` → first element wins, anything else → `"unknown"` (the caller
 * maps that to a rejection).
 *
 * D-13: this is a LIVE re-query — never trust stale persisted state before a
 * money-moving action.
 */
export async function getCardChargeDetails(
  chargeId: string | number,
): Promise<{ status: string }> {
  const raw = String(chargeId);
  if (raw.trim() === "" || Number.isNaN(Number(raw))) {
    throw efiError("Cobrança inválida", "EFI_INVALID_REQUEST", false);
  }
  const result = await efiRequest<{ data?: unknown }>({
    family: "cobrancas",
    path: `/v1/charge/${encodeURIComponent(raw)}`,
    method: "GET",
  });
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  if (data && typeof data === "object") {
    const status = (data as Record<string, unknown>).status;
    if (status !== null && typeof status === "object") {
      const current = (status as Record<string, unknown>).current;
      return { status: typeof current === "string" ? current : "unknown" };
    }
    if (typeof status === "string") {
      return { status };
    }
  }
  return { status: "unknown" };
}

/**
 * Efí card refund request (Plan 30-02 — ORDER-04, parity
 * `Backend/app/payment/service.py` refund_card_charge L631-667).
 *
 * - Bonus body parity: `body or None` — on a FULL refund no body is sent at
 *   all (never `amount: null` / `amount: 0`); partial refunds send
 *   `{ amount: cents }`.
 * - `amount <= 0` → EFI_INVALID_REQUEST (Python ValueError parity), no call.
 * - result.code 200/201 → success shape; anything else → EFI_INVALID_REQUEST
 *   with a PT-BR message built from `error_description ?? mensagem ??
 *   "Erro desconhecido"` (service.py:647-651 parity). The charge id / raw body
 *   are never interpolated wholesale (T-25-03).
 */
export async function refundCardCharge(
  chargeId: string,
  amount?: number,
): Promise<{ status: string; message: string; response: unknown }> {
  if (amount !== undefined && amount <= 0) {
    throw efiError("Amount deve ser positivo em centavos", "EFI_INVALID_REQUEST", false);
  }
  const result = await efiRequest<
    { code?: number; message?: string; error_description?: string; mensagem?: string } | undefined
  >({
    family: "cobrancas",
    path: `/v1/charge/card/${encodeURIComponent(chargeId)}/refund`,
    method: "POST",
    ...(amount !== undefined ? { body: { amount } } : {}),
  });
  if (!result || (result.code !== 200 && result.code !== 201)) {
    const reason = result?.error_description ?? result?.mensagem ?? "Erro desconhecido";
    throw efiError(`Falha no estorno: ${reason}`, "EFI_INVALID_REQUEST", false);
  }
  return {
    status: "success",
    message: result.message ?? "Estorno solicitado com sucesso",
    response: result,
  };
}

// ─── https.request JSON helper ────────────────────────────────────────────

function requestJson<T>(url: string, options: RequestOptions, body?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = httpsRequest(url, options, (res) => {
      const chunks: string[] = [];
      res.on("data", (chunk: unknown) => {
        chunks.push(String(chunk));
      });
      // WR-01 — a mid-body socket reset (server closes with RST / connection
      // dies) never fires req 'error', it aborts the RESPONSE stream. Without
      // this handler the awaiting route pends forever.
      res.on("error", () => {
        reject(efiError("Efí indisponível", "EFI_UNREACHABLE", true));
      });
      res.on("end", () => {
        const raw = chunks.join("");
        const status = res.statusCode ?? 0;

        if (status >= 200 && status < 300) {
          if (!raw) {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(efiError("Resposta inválida da Efí", "EFI_INVALID_REQUEST", false));
          }
          return;
        }

        reject(mapEfiStatus(status));
      });
    });

    req.on("error", () => {
      reject(efiError("Efí indisponível", "EFI_UNREACHABLE", true));
    });

    // WR-01 — a connection that is silently DROPPED (no RST, no response —
    // e.g. a wedged LB) must not pend the route indefinitely. Bound the whole
    // exchange: on expiry destroy the request; the error surfaces through the
    // req 'error' handler above.
    req.setTimeout(15_000, () => {
      req.destroy(new Error("Efí indisponível"));
    });

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

// ─── D-12 error shape ──────────────────────────────────────────────────────
// PT-BR messages fixed at compile time — raw HTTP bodies, client_id, secrets
// and access tokens are NEVER interpolated (T-25-03).

function mapEfiStatus(status: number): EfiError {
  switch (status) {
    case 401:
      return efiError("Não autorizado na Efí", "EFI_UNAUTHORIZED", false);
    case 429:
      return efiError("Limite de requisições à Efí excedido", "EFI_RATE_LIMITED", true);
    default:
      if (status >= 500) {
        return efiError("Erro interno da Efí", "EFI_SERVER_ERROR", true);
      }
      return efiError("Requisição inválida à Efí", "EFI_INVALID_REQUEST", false);
  }
}

function efiError(error: string, code: string, retryable: boolean): EfiError {
  return { error, code, retryable };
}