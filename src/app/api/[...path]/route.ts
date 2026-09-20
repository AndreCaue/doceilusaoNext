import { NextResponse, type NextRequest } from "next/server";
import { ALLOWED_PREFIXES, isSafeProxyPath, proxyRequest } from "@/lib/strangler-proxy";

// Strangler-fig catch-all proxy (FOUND-04, D-09).
//
// Any unmigrated /api/<module>/... request under the D-11 allowlist is forwarded
// to FastAPI at BACKEND_URL with the `/api` prefix stripped; everything else —
// including /api/admin/* (Phase 27's explicit routes already shadow those —
// this guard is defense in depth, T-25-01) — returns 404 and is NEVER forwarded.
//
// Route precedence: static > dynamic > catch-all, so the 8 Phase 27 admin route
// files always win over [...path]; zero structure change needed when a module
// migrates: its path leaves the allowlist and/or an explicit Next route shadows it.

type TParams = { path: string[] };

const NOT_FOUND_BODY = JSON.stringify({
  error: "Rota não encontrada",
  code: "NOT_FOUND",
  retryable: false,
});

async function handleRequest(
  req: NextRequest,
  params: Promise<TParams>,
  method: string,
): Promise<NextResponse> {
  const segments = (await params).path;

  // Guard 1 — D-11 allowlist + traversal-safe path check BEFORE any forwarding.
  // `admin` is absent from ALLOWED_PREFIXES, so /api/admin/* dies here even if
  // a route were ever removed; isSafeProxyPath rejects percent-encoded/`.`.`..`
  // segments so a double-encoded traversal can never reach the backend (CR-01).
  if (
    !ALLOWED_PREFIXES.includes(segments[0] ?? "") ||
    !isSafeProxyPath(segments)
  ) {
    return new NextResponse(NOT_FOUND_BODY, {
      status: 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // Guard 2 — D-10 backend config: proxyRequest returns the 500
  // SERVER_MISCONFIGURED D-12 shape when BACKEND_URL is missing.

  // Backend serves at root (admin-proxy precedent) — strip `/api` by joining the
  // segments, then append the original query string verbatim.
  const backendPath = `${segments.join("/")}${req.nextUrl.search}`;

  // Only Content-Type is forwarded from the browser request (anti-desync); the
  // hop-by-hop strip + env-fixed target live inside proxyRequest (T-25-02).
  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) {
    headers["Content-Type"] = contentType;
  }

  // GET/HEAD carry no body; only non-GET/HEAD bodies are read and forwarded.
  const shouldReadBody = method !== "GET" && method !== "HEAD";

  const result = await proxyRequest(backendPath, {
    method,
    ...(shouldReadBody ? { body: await req.text() } : {}),
    headers,
    cookies: req.headers.get("cookie"),
  });

  return new NextResponse(result.body, {
    status: result.status,
    headers: {
      "Content-Type": result.headers["content-type"] ?? "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<TParams> }) {
  return handleRequest(req, params, "GET");
}

export async function POST(req: NextRequest, { params }: { params: Promise<TParams> }) {
  return handleRequest(req, params, "POST");
}

export async function PUT(req: NextRequest, { params }: { params: Promise<TParams> }) {
  return handleRequest(req, params, "PUT");
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<TParams> }) {
  return handleRequest(req, params, "PATCH");
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<TParams> }) {
  return handleRequest(req, params, "DELETE");
}