// PUT /api/cart/update — updates an item's quantity in the authenticated user's
// active cart.
//
// Behavior parity (Python backend cart update endpoint):
//   * getCurrentUser(req) — 401 D-12 shape on missing/invalid token (T-28-02-01)
//   * zod validation: item_id positive int, quantity positive int >= 1
//     (T-28-02-04: input validation at route entry)
//   * updateItem: IDOR guard (item must belong to the user's active cart,
//     T-28-02-02), server-side stock re-validation (T-28-02-03), total_price
//     recalculated from snapshotted unit_price
//   * 200 body: CartSummary + `{ message: "Carrinho atualizado" }`
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { CartError, updateItem } from "@/lib/cart";

const updateSchema = z.object({
  item_id: z.number().int().positive(),
  quantity: z.number().int().positive(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);

    // Parse and validate body (T-28-02-04)
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Corpo da requisição inválido", code: "INVALID_BODY", retryable: false },
        { status: 400 },
      );
    }

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", code: "VALIDATION_ERROR", retryable: false },
        { status: 400 },
      );
    }

    const summary = await updateItem(user.uuid, parsed.data.item_id, parsed.data.quantity);

    return NextResponse.json(
      { ...summary, message: "Carrinho atualizado" },
      { status: 200 },
    );
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