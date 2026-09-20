// GET /api/auth/me — port of Backend/app/auth/routes.py:524-531 (read_users_me).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/me.
//
// Behavior parity (AUTH-08 identity source, D-15 provider contract):
//   * `getCurrentUser(req)` — Bearer header → access_token cookie fallback
//     (D-01/D-02), 401 D-12 shape on missing/invalid token (T-26-07-04: same
//     message both ways — no user enumeration)
//   * scopes normalized by guards.ts (DB JSON column: array OR "a,b" string →
//     string[]) — routes.py:211-213 parity
//   * 200 body is the EXACT D-15 shape `{ email, scopes, is_verified,
//     is_master }` — byte-matches routes.py:526-530; consumers (Topbar,
//     UserTopbar, Sidebar, (admin) layout, 26-09 provider) read user.email /
//     user.isMaster from this
//   * is_master = `"master" in scopes && role === "master"` (models.py:47-49,
//     routes.py:530) — computed by guards.ts isMasterUser from the DB row
//   * cache-control: no-store — identity is never cacheable
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

/** 401 with backend parity `WWW-Authenticate: Bearer` (guards.ts contract). */
function unauthorizedResponse(message: string, code: string) {
  return NextResponse.json(
    { error: message, code, retryable: false },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

export async function GET(req: NextRequest) {
  try {
    // Identity gate — access-token based (guards.ts contract; 401 on
    // missing/invalid/wrong-type token, D-01 cookie fallback included, live
    // DB row required — token alone is never sufficient, T-26-02-02).
    const user = await getCurrentUser(req);

    // routes.py:526-530 EXACT shape — D-15 provider contract. Note: scopes
    // come normalized from guards.ts (DB JSON column), is_master computed from
    // role + scope (models.py:47-49). NO uuid — byte-match parity with the
    // backend's me response.
    const body = {
      email: user.email,
      scopes: user.scopes,
      is_verified: user.is_verified,
      is_master: user.is_master,
    };

    // Identity is never cacheable (routes.py:524-531 has no cache headers;
    // explicit no-store prevents any accidental shared/CDN caching).
    return NextResponse.json(body, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      // getCurrentUser AuthErrors are 401 — carry WWW-Authenticate (backend parity).
      if (err.status === 401) {
        return unauthorizedResponse(err.message, err.code);
      }
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}