// POST /api/cart/add — adds a product to the authenticated user's active cart.
//
// Behavior parity (Python backend cart add endpoint):
//   * getCurrentUser(req) — 401 D-12 shape on missing/invalid token (T-28-02-01)
//   * zod validation: product_id positive int, quantity optional >= 1 (default 1)
//     (T-28-02-04: input validation at route entry)
//   * addItem: server-side stock validation (T-28-02-03), unit price snapshot,
//     idempotent increment when the product is already in the cart
//   * 200 body: CartSummary + `{ message: "Produto adicionado ao carrinho" }`
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { addItem, CartError } from "@/lib/cart";

const addSchema = z.object({
  product_id: z.number().int().positive(),
  quantity: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
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

    const parsed = addSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", code: "VALIDATION_ERROR", retryable: false },
        { status: 400 },
      );
    }

    const quantity = parsed.data.quantity ?? 1;
    const summary = await addItem(user.uuid, parsed.data.product_id, quantity);

    return NextResponse.json(
      { ...summary, message: "Produto adicionado ao carrinho" },
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