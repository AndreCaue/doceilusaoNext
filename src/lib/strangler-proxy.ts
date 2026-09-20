// Strangler-fig fallback proxy core (FOUND-04, D-09/D-10/D-11/D-12).
//
// Generalizes the backendFetch contract proven by admin-proxy.ts (Phase 27) into
// a reusable catch-all proxy for unmigrated module requests:
//   * Target URL built ONLY from env-fixed process.env.BACKEND_URL (D-10) +
//     the caller-stripped path — request-supplied URLs/hosts are never used
//     (anti-SSRF / anti-open-proxy, T-25-02).
//   * Explicit per-module allowlist (D-11) enforced by the route handler;
//     `admin` is intentionally ABSENT (migrated to Next in Phase 27).
//   * Standardized D-12 error shape `{ error, code, retryable }` on every
//     failure mode (502 unreachable / 504 timeout retryable:true, passthrough
//     status for backend 4xx/5xx), PT-BR strings consistent with admin-proxy.
//   * Hop-by-hop headers stripped before forwarding (anti-desync); only
//     content-type is echoed back to the client.
//   * 30s AbortController timeout covering fetch AND body read (WR-01).
//   * Backend redirects refused (redirect:"error", WR-02/WR-03) — a 3xx is
//     never followed and never passed through with a stripped Location.
//   * Traversal-safe path guard (CR-01): plain tokens only (no percent-encoding,
//     no "." / "..", no embedded separators) + post-resolution allowlist re-check
//     so a double-encoded dot segment can never escape the module namespace.
//
// Do NOT edit admin-proxy.ts — it stays the Phase 27 admin contract.

// ─── Standardized proxy error shape (Phase 25 D-12) ────────────
export type ProxyError = {
  error: string;
  code: string;
  retryable: boolean;
};

// ─── D-11 module allowlist ─────────────────────────────────────
// First-segment membership is enforced by the catch-all route handler before
// ANY forwarding (T-25-01). `admin` is deliberately absent — Phase 27's explicit
// /api/admin/* routes shadow those paths; the catch-all 404s them as defense in
// depth. `auth` left the allowlist in Phase 26 (all 12 auth endpoints shadowed
// by explicit Next routes) — the catch-all now 404s ALL /api/auth/* paths that
// lack an explicit Next route (defense in depth under the static-route
// shadowing; a forgotten future auth route must NEVER silently forward to
// Python — single-writer purity, T-26-08-03). 14 entries.
export const ALLOWED_PREFIXES: readonly string[] = [
  "products",
  "cart",
  "payment",
  "orders",
  "contents",
  "cep",
  "webhook",
  "subscription",
  "refunds",
  "dashboard",
  "melhor-envio",
  "dropdown",
  "helpers",
  "sidebar",
];

// ─── Traversal-safe path validation (CR-01) ────────────────────
// The allowlist alone is insufficient: `/api/helpers/%252e%252e/admin` reaches
// the backend as `/helpers/../admin` (Node 22 collapses double-encoded dot
// segments), escaping the module namespace. Reject any segment that is not a
// plain token — no percent-encoding (Next has already single-decoded segments
// at this layer, so any remaining "%" implies deep-encoding), no raw "." / "..",
// no embedded "/" or "\". Allowlisted modules are plain nouns; if a future
// module needs encoded path values it must ship explicit Next routes instead.
export function isSafeProxyPath(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    if (segment.length === 0) return false;
    if (segment.includes("%")) return false;
    if (segment === "." || segment === "..") return false;
    if (segment.includes("/") || segment.includes("\\")) return false;
    return true;
  });
}

// ─── Result contract for the route handler ─────────────────────
export type ProxyRequestResult = {
  status: number;
  /** Minimal echo header set — content-type only (T-25-03). */
  headers: Record<string, string>;
  /** Raw backend body text — the route handler re-emits it. */
  body: string;
  ok: boolean;
};

// Hop-by-hop headers (RFC 9110 §7.6.1) — never forwarded to the backend.
// `proxy-*` handled by prefix match below.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "host",
  "upgrade",
  "te",
  "trailer",
]);

function isHopByHop(name: string): boolean {
  return HOP_BY_HOP.has(name) || name.startsWith("proxy-");
}

function proxyErrorBody(error: string, code: string, retryable: boolean): string {
  return JSON.stringify({ error, code, retryable });
}

/**
 * Forward one request to the FastAPI backend.
 *
 * @param path Target path with the `/api` prefix ALREADY stripped (backend
 *             serves at root — admin-proxy precedent `/products/register`).
 * @param init Optional method / body / extra headers / browser cookie string.
 */
export async function proxyRequest(
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    headers?: HeadersInit;
    cookies?: string | null;
  },
): Promise<ProxyRequestResult> {
  const BACKEND_URL = process.env.BACKEND_URL;
  if (!BACKEND_URL) {
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: proxyErrorBody("BACKEND_URL não configurado", "SERVER_MISCONFIGURED", true),
      ok: false,
    };
  }

  // Anti-SSRF (T-25-02): target is env-fixed + caller path only. Never accept a
  // target URL from the request.
  const rawUrl = `${BACKEND_URL}/${path}`;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      status: 500,
      headers: { "content-type": "application/json" },
      body: proxyErrorBody("URL de backend inválida", "SERVER_MISCONFIGURED", true),
      ok: false,
    };
  }

  // Defense in depth for CR-01: after URL normalization collapses any residual
  // dot segments, the resolved first path segment MUST still be allowlisted.
  // Anything else is 404 — never forwarded.
  const resolvedFirst = url.pathname.split("/").find(Boolean) ?? "";
  if (resolvedFirst === "" || !ALLOWED_PREFIXES.includes(resolvedFirst)) {
    return {
      status: 404,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: "Rota não encontrada",
        code: "NOT_FOUND",
        retryable: false,
      }),
      ok: false,
    };
  }

  const method = init?.method ?? "GET";

  // Forwarded headers: caller-supplied (e.g. Content-Type) minus hop-by-hop,
  // plus the browser Cookie when provided (identity semantics == admin-proxy's
  // access_token forwarding so Python's auth sees the same user).
  const headers = new Headers(init?.headers);
  for (const name of [...headers.keys()]) {
    if (isHopByHop(name.toLowerCase())) {
      headers.delete(name);
    }
  }
  if (init?.cookies) {
    headers.set("Cookie", init.cookies);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method,
        body: init?.body ?? null,
        headers,
        signal: controller.signal,
        // Server data is live — never serve stale proxied responses.
        cache: "no-store",
        // WR-02: never follow backend redirects — a 3xx Location could be
        // attacker-controlled and must not be re-targeted.
        redirect: "error",
      });

      // WR-03: with redirect:"error" fetch refuses 3xx, but keep an explicit
      // guard so no redirect is ever passed through with its Location stripped.
      if (res.status >= 300 && res.status < 400) {
        return {
          status: 502,
          headers: { "content-type": "application/json" },
          body: proxyErrorBody("Redirecionamento não suportado pelo proxy", "BACKEND_ERROR", false),
          ok: false,
        };
      }

      // WR-01: the 30s budget covers the body read too — a mid-body stall must
      // still surface as a 504, so the timeout is only cleared via finally.
      const text = await res.text();

      if (!res.ok) {
        // FastAPI 4xx/5xx → passthrough status, standardized shape (D-12).
        let detail: string | null = null;
        try {
          const parsed = text ? JSON.parse(text) : null;
          if (parsed && typeof parsed === "object" && "detail" in parsed) {
            detail = String((parsed as Record<string, unknown>).detail);
          }
        } catch {
          detail = null;
        }
        return {
          status: res.status,
          headers: { "content-type": "application/json" },
          body: proxyErrorBody(detail ?? (text || "Erro ao contatar o backend"), "BACKEND_ERROR", false),
          ok: false,
        };
      }

      // Echo only content-type (T-25-03) — no backend internal headers leak.
      const echoHeaders: Record<string, string> = {};
      const contentType = res.headers.get("content-type");
      if (contentType) {
        echoHeaders["content-type"] = contentType;
      }

      return { status: res.status, headers: echoHeaders, body: text, ok: true };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      status: aborted ? 504 : 502,
      headers: { "content-type": "application/json" },
      body: proxyErrorBody(
        aborted ? "Tempo esgotado ao contatar o backend" : "Falha ao contatar o backend",
        aborted ? "TIMEOUT" : "BACKEND_UNREACHABLE",
        true,
      ),
      ok: false,
    };
  }
}