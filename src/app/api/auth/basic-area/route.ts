// GET /api/auth/basic-area — port of Backend/app/auth/routes.py:268-270
// (basic_area).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/basic-area.
//
// Scope-gate proof endpoint (AUTH-08 server-side half): a user with the
// "basic" token scope gets a 200 echo; anyone else gets 403.
//
// Behavior parity (routes.py:268-270 + FastAPI Security scopes):
//   * `getCurrentUser(req)` — Bearer header → access_token cookie fallback
//     (D-01/D-02), 401 D-12 shape on missing/invalid token; live DB row
//     required (token alone never sufficient, T-26-02-02)
//   * scope gate uses TOKEN scopes — `payload.scopes` decoded from the access
//     JWT (dependencies.py:73-76 commented get_current_user: Security scopes
//     check token claims, string-or-array normalized) — NOT fresh DB scopes:
//     the token is the session contract; a grant takes effect on next issuance
//     (routes.py:294-297 parity, T-26-07-03 accepted)
//   * token lacks "basic" → 403 { error: "Permissão insuficiente", code:
//     "FORBIDDEN", retryable: false } (dependencies.py:88-93 parity)
//   * 200 → { message: `Acesso básico concedido para ${email}` } (routes.py:270)
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser, getTokenFromRequest } from "@/lib/auth/guards";
import { AuthError, decodeToken } from "@/lib/auth/jwt";

/** Normalize token scopes — string-or-array (dependencies.py:75-76 parity). */
function tokenScopesFromPayload(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes.filter((s): s is string => typeof s === "string");
  }
  if (typeof scopes === "string") {
    return scopes.split(",").filter(Boolean);
  }
  return [];
}

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
    // DB row required).
    const identity = await getCurrentUser(req);

    // SCOPE GATE — token scopes, NOT DB scopes (T-26-07-03 accepted, plan task
    // 3 step 4): the access JWT's `scopes` claim is the session contract. A
    // token minted before a premium grant keeps the old claims until refresh.
    const token = getTokenFromRequest(req);
    // getCurrentUser succeeded ⇒ the same request still carries the token.
    const payload = await decodeToken(token as string);
    const tokenScopes = tokenScopesFromPayload(payload.scopes);

    if (!tokenScopes.includes("basic")) {
      // dependencies.py:88-93 parity — FastAPI Security scopes 403.
      return NextResponse.json(
        { error: "Permissão insuficiente", code: "FORBIDDEN", retryable: false },
        { status: 403 },
      );
    }

    // routes.py:270 parity.
    return NextResponse.json(
      { message: `Acesso básico concedido para ${identity.email}` },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof AuthError) {
      // getCurrentUser/decodeToken AuthErrors are 401 — carry WWW-Authenticate
      // (backend parity).
      if (err.status === 401) {
        return unauthorizedResponse(err.message, err.code);
      }
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}