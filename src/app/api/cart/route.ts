// GET /api/cart — returns the active cart summary for the authenticated user.
//
// Behavior parity (Python backend cart summary endpoint):
//   * getCurrentUser(req) — Bearer header → access_token cookie fallback,
//     401 D-12 shape on missing/invalid token (T-28-02-01: auth enforced)
//   * getCartSummary resolves the user's numeric id from uuid internally
//   * 200 body: CartSummary `{ id, items, itemCount, subtotal, discount, total }`
//     (empty summary if no active cart exists)
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { getCartSummary } from "@/lib/cart";
import { CartError } from "@/lib/cart";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const summary = await getCartSummary(user.uuid);
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.status === 401) {
        return NextResponse.json(
          { error: err.message, code: err.code, retryable: false },
          { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
        );
      }
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: false },
        { status: err.status },
      );
    }
    if (err instanceof CartError) {
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: false },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
      { status: 500 },
    );
  }
}