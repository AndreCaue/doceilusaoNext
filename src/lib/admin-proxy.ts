// Admin proxy helpers — master-scope checked forwarding to the Python backend
// (STORE-04 product-options data path + STORE-05 product writes).
//
// Design (Phase 27 D-11/D-12/D-15):
//   * Product create/update/delete MUST run in Python (single-writer): S3 upload,
//     image-replace semantics, shipping-preset autofill, stock/price validation
//     all live in `Backend/app/store`. Next.js only orchestrates the forms and
//     proxies the writes.
//   * Reads come from Prisma (D-02) via src/lib/catalog.ts — never proxied here.
//   * Every helper enforces the master scope gate (D-15) server-side BEFORE
//     forwarding (T-27-06-01), mirroring the Phase 26 auth boundary. The browser's
//     auth cookie is ALSO forwarded so Python's own `require_master_full_access`
//     re-validates (defense in depth).
//
// Phase 25 proxy contract: BACKEND_URL env var (server-only) + standardized error
// shape `{ error, code, retryable }`.

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

// ─── Config ────────────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL;
const AUTH_SECRET = process.env.SECRET_KEY ?? process.env.AUTH_SECRET;

// Cookie used by the Python backend JWT flow (`Backend/app/auth/dependencies.py`).
const ACCESS_COOKIE = "access_token";

// ─── Standardized proxy error shape (Phase 25 D-12) ────────────
export type ProxyError = {
  error: string;
  code: string;
  retryable: boolean;
};

function proxyError(error: string, code: string, retryable = false): ProxyError {
  return { error, code, retryable };
}

// ─── Master-scope gate (T-27-06-01) ────────────────────────────
//
// Verifies the request carries a valid access JWT whose `scopes` include "master".
// The token format matches the Python backend access token (Backend/app/auth/jwt.py):
// `{ sub: email, type: "access", scopes: [...] }`, signed with the shared SECRET_KEY
// using HS256. This is the server-side enforcement point for admin API routes — the
// `(admin)` page layout gate is insufficient because API routes are reachable directly.
export async function requireMaster(
  req?: NextRequest,
): Promise<{ ok: true; email: string | null } | { ok: false; status: number; error: ProxyError }> {
  let token: string | undefined;

  if (req) {
    // Cookie can be forwarded via the request header. NextRequest helpers:
    token = req.cookies.get(ACCESS_COOKIE)?.value;
  } else {
    const store = await cookies();
    token = store.get(ACCESS_COOKIE)?.value;
  }

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: proxyError("Não autenticado", "UNAUTHORIZED"),
    };
  }

  if (!AUTH_SECRET) {
    return {
      ok: false,
      status: 500,
      error: proxyError("Falha de configuração do servidor", "SERVER_MISCONFIGURED", true),
    };
  }

  try {
    const secretKey = new TextEncoder().encode(AUTH_SECRET);
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });

    if (payload.type !== "access") {
      return {
        ok: false,
        status: 401,
        error: proxyError("Token inválido", "INVALID_TOKEN"),
      };
    }

    const scopes = payload.scopes;
    const hasMaster = Array.isArray(scopes)
      ? scopes.includes("master")
      : typeof scopes === "string"
        ? scopes.split(",").includes("master")
        : false;

    if (!hasMaster) {
      return {
        ok: false,
        status: 403,
        error: proxyError("Permissão insuficiente", "FORBIDDEN"),
      };
    }

    return { ok: true, email: (payload.sub as string | null) ?? null };
  } catch {
    return {
      ok: false,
      status: 401,
      error: proxyError("Token inválido ou expirado", "INVALID_TOKEN"),
    };
  }
}

// ─── Low-level backend fetch (Phase 25 proxy contract) ──────────

type ProxyResult<T> = { ok: true; data: T } | { ok: false; status: number; data: ProxyError };

async function backendFetch(
  path: string,
  init: {
    method?: string;
    body?: BodyInit | null;
    headers?: HeadersInit;
    token?: string | null;
    asFormData?: boolean;
  } = {},
): Promise<ProxyResult<unknown>> {
  if (!BACKEND_URL) {
    return {
      ok: false,
      status: 500,
      data: proxyError("BACKEND_URL não configurado", "SERVER_MISCONFIGURED", true),
    };
  }

  const { method = "GET", body = null, headers = {}, token } = init;
  const url = `${BACKEND_URL}${path}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const reqHeaders: Record<string, string> = {
      ...(headers as Record<string, string>),
    };
    if (token) reqHeaders.Cookie = `${ACCESS_COOKIE}=${token}`;

    const res = await fetch(url, {
      method,
      body,
      headers: reqHeaders,
      // Do NOT set Content-Type for FormData — browsers (and undici) set the
      // multipart boundary automatically.
      duplex: init.asFormData ? "half" : undefined,
      signal: controller.signal,
      cache: "no-store",
    } as RequestInit);

    clearTimeout(timeout);

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    if (!res.ok) {
      // Reformat FastAPI 4xx/5xx into the standard shape (passthrough status).
      const errBody =
        json && typeof json === "object" && "detail" in (json as Record<string, unknown>)
          ? String((json as Record<string, unknown>).detail)
          : text;
      return {
        ok: false,
        status: res.status,
        data: proxyError(errBody || "Erro ao contatar o backend", "BACKEND_ERROR"),
      };
    }

    return { ok: true, data: json };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      data: proxyError(
        aborted ? "Tempo esgotado ao contatar o backend" : "Falha ao contatar o backend",
        aborted ? "TIMEOUT" : "BACKEND_UNREACHABLE",
        true,
      ),
    };
  }
}

async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

// ─── Dropdown proxies (STORE-04) ───────────────────────────────

export type DropdownCategoryItem = { id: number; descricao: string };
export type DropdownShippingPresetItem = { id: number; name: string };

export async function proxyDropdownCategory(): Promise<
  ProxyResult<DropdownCategoryItem[]>
> {
  const token = await getAccessToken();
  return (await backendFetch("/dropdown/category", {
    method: "GET",
    token,
  })) as ProxyResult<DropdownCategoryItem[]>;
}

export async function proxyDropdownShippingPresets(): Promise<
  ProxyResult<DropdownShippingPresetItem[]>
> {
  const token = await getAccessToken();
  return (await backendFetch("/dropdown/shipping-presets", {
    method: "GET",
    token,
  })) as ProxyResult<DropdownShippingPresetItem[]>;
}

export type ShippingPresetDetail = {
  id: number;
  name: string;
  height_cm: number;
  length_cm: number;
  weight_grams: number;
  width_cm: number;
  discount?: number;
};

/** Fetch a single shipping preset by id for handleChangePresets autofill. */
export async function proxyShippingPresetById(
  id: number,
): Promise<ProxyResult<ShippingPresetDetail>> {
  const token = await getAccessToken();
  return (await backendFetch(`/helpers/shipping-presets/${id}`, {
    method: "GET",
    token,
  })) as ProxyResult<ShippingPresetDetail>;
}

// ─── Product write proxies (STORE-05, D-11/D-12) ───────────────

export type ProxyProductResponse = {
  id?: number;
  message?: string;
  [key: string]: unknown;
};

export async function proxyProductCreate(
  formData: FormData,
): Promise<ProxyResult<ProxyProductResponse>> {
  const token = await getAccessToken();
  // `asFormData` signals undici to leave the multipart boundary automatic.
  return (await backendFetch("/products/register", {
    method: "POST",
    body: formData as unknown as BodyInit,
    token,
    asFormData: true,
  })) as ProxyResult<ProxyProductResponse>;
}

export async function proxyProductUpdate(
  id: number,
  formData: FormData,
): Promise<ProxyResult<ProxyProductResponse>> {
  const token = await getAccessToken();
  return (await backendFetch(`/products/${id}`, {
    method: "PUT",
    body: formData as unknown as BodyInit,
    token,
    asFormData: true,
  })) as ProxyResult<ProxyProductResponse>;
}

export async function proxyProductDelete(
  id: number,
): Promise<ProxyResult<ProxyProductResponse>> {
  const token = await getAccessToken();
  return (await backendFetch(`/products/${id}`, {
    method: "DELETE",
    token,
  })) as ProxyResult<ProxyProductResponse>;
}

// ─── Category write proxies (STORE-06, D-11/D-14) ──────────────
//
// Category CRUD stays single-writer in Python (create/update/delete).
// Python enforces lowercase-unique name on create/update and the
// product-reference delete guard (D-14) — Next just forwards.

export type ProxyCategoryResponse = {
  id?: number;
  id_removido?: number;
  message?: string;
  [key: string]: unknown;
};

export async function proxyCategoryCreate(
  body: Record<string, unknown>,
): Promise<ProxyResult<ProxyCategoryResponse>> {
  const token = await getAccessToken();
  return (await backendFetch("/category/register", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    token,
  })) as ProxyResult<ProxyCategoryResponse>;
}

export async function proxyCategoryUpdate(
  id: number,
  body: Record<string, unknown>,
): Promise<ProxyResult<ProxyCategoryResponse>> {
  const token = await getAccessToken();
  return (await backendFetch(`/category/update/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    token,
  })) as ProxyResult<ProxyCategoryResponse>;
}

export async function proxyCategoryDelete(
  id: number,
): Promise<ProxyResult<ProxyCategoryResponse>> {
  const token = await getAccessToken();
  return (await backendFetch(`/category/delete/${id}`, {
    method: "DELETE",
    token,
  })) as ProxyResult<ProxyCategoryResponse>;
}
