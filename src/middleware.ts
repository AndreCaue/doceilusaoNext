// Edge auth gate (Phase 26 Plan 08 — AUTH-08, D-12/D-13).
//
// Runtime rules (D-12): "Edge for auth, Node for payments".
//   * Edge middleware verifies access-token JWTs with jose ONLY — no Prisma,
//     no bcrypt, no node:crypto, no fetch (Edge runtime constraint, T-26-08-02).
//     Any forbidden import here fails the build, not silently at runtime.
//   * The middleware is READ-ONLY (D-13): it never initiates a refresh, never
//     writes cookies, never touches the DB. A missing/expired token simply
//     redirects to /login — the provider handles refresh client-side (26-09).
//   * /api/auth/* bypasses this gate entirely (matcher below) — JWTs are
//     verified inside those route handlers on the Node runtime instead (D-12).
//
// Scope gate (D-12): the (admin) route group is guarded for `master` scope at
// the edge. This replaces the client-side useAuth check that used to live in
// src/app/(admin)/layout.tsx (trivially bypassable) — the edge cannot be skipped.

// Subpath import (jose/jwt/verify) — NOT the jose barrel: the barrel pulls the
// JWE-deflate module (CompressionStream/DecompressionStream) into the Edge
// bundle, which the Edge Runtime does not support (build warning). We only
// verify HS256 JWTs, so this middleware bundles exactly what it uses.
import { jwtVerify } from "jose/jwt/verify";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_SECRET } from "@/lib/auth/config";

// D-02 cookie name parity with the Python backend (routes.py:244-253, 379-388).
const ACCESS_COOKIE = "access_token";

/**
 * Fail-closed redirect per the D-06 contract: /login?redirect=<original path>.
 * The redirect value is built ONLY from req.nextUrl.pathname + search — same
 * origin, encodeURIComponent'd — never from a client-supplied header/query
 * (open-redirect protection, T-26-08-05).
 */
function redirectToLogin(req: NextRequest): NextResponse {
  const target = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  return NextResponse.redirect(
    new URL(`/login?redirect=${encodeURIComponent(target)}`, req.url),
  );
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;

  // No cookie → not logged in → send to login (D-06 UX convention). The API
  // routes still answer 401; pages redirect so the user can recover.
  if (!token) {
    return redirectToLogin(req);
  }

  // Secret missing (SERVER_MISCONFIGURED) → fail closed: redirect as well.
  // Edge logging is coarse but present.
  if (!AUTH_SECRET) {
    console.error(
      "SERVER_MISCONFIGURED: SECRET_KEY (ou AUTH_SECRET) não configurado — middleware não pode verificar tokens",
    );
    return redirectToLogin(req);
  }

  try {
    // HS256 pinned + shared SECRET_KEY — jose pins both alg and key, so no
    // algorithm-confusion is possible (T-26-08-01). Pattern precedent:
    // src/lib/admin-proxy.ts:78-79.
    const secretKey = new TextEncoder().encode(AUTH_SECRET);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    // A refresh/reset token must never unlock pages — only access tokens pass.
    if (payload.type !== "access") {
      return redirectToLogin(req);
    }

    // Master scope gate for the (admin) route group (D-12). The southbound
    // admin API routes still enforce 401/403 via requireMasterFullAccess —
    // this edge gate keeps non-masters off the pages entirely. A logged-in
    // non-master is redirected to login (friendlier than a raw 403; UI
    // convention per D-06) — the API layer below keeps hard 401/403 semantics.
    const scopes: string[] = Array.isArray(payload.scopes)
      ? payload.scopes
      : [];
    if (!scopes.includes("master")) {
      return redirectToLogin(req);
    }
  } catch {
    // Invalid or expired signature → read-only per D-13: NO refresh attempt
    // here. Redirect; the provider refreshes on the client (26-09).
    return redirectToLogin(req);
  }

  return NextResponse.next();
}

// Match the protected route groups ONLY (D-12):
//   * /admin/:path* — the (admin) master gate this phase. Future phases
//     (31 content gates) extend this list.
// Deliberately NOT matched (bypass):
//   * /api/auth/:path* — JWTs verified inside route handlers (Node runtime)
//   * /api/* — API auth is in-route
//   * /login, /cadastro, /verificar-email, /esqueci-senha, /redefinir-senha —
//     public auth pages
//   * /loja, /, _next/*, favicon — public/static assets
export const config = {
  matcher: ["/admin/:path*"],
};