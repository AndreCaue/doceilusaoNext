// DELETE /api/cart/remove — removes an item from the authenticated user's
// active cart.
//
// Behavior parity (Python backend cart remove endpoint):
//   * getCurrentUser(req) — 401 D-12 shape on missing/invalid token (T-28-02-01)
//   * zod validation: item_id positive int (T-28-02-04: input validation)
//   * removeItem: IDOR guard (item must belong to the user's active cart,
//     T-28-02-02), then deletes the item
//   * 200 body: CartSummary + `{ message: "Produto removido do carrinho" }`
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { CartError, removeItem } from "@/lib/cart";

const removeSchema = z.object({
  item_id: z.number().int().positive(),
});

export async function DELETE(req: NextRequest) {
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

    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", code: "VALIDATION_ERROR", retryable: false },
        { status: 400 },
      );
    }

    const summary = await removeItem(user.uuid, parsed.data.item_id);

    return NextResponse.json(
      { ...summary, message: "Produto removido do carrinho" },
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