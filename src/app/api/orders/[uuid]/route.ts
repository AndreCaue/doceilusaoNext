// GET /api/orders/[uuid] — order detail (Plan 30-03, ORDER-03).
//
// Parity: `Backend/app/store/orders/routes.py:150-236` GET /orders/{order_uuid}
// via plan 30-01's getOrderDetailForUser kind discrimination:
//   not_found  → 404 ORDER_NOT_FOUND "Pedido não encontrado"
//   forbidden  → 403 ORDER_FORBIDDEN "Sem permissão para ver este pedido" (D-07)
//   ok+expired → 410 ORDER_EXPIRED "O prazo de reserva deste pedido expirou.
//                Inicie um novo checkout." (routes.py:188-193)
//   ok         → 200 OrderDetailOrder passthrough
//
// Auth: getCurrentUser → 401 D-12 + numeric id resolution (checkout
// route.ts:95-98 precedent). T-30-03-01: a malformed (non UUID v4) path
// param 404s BEFORE any query — no existence oracle, getOrderDetailForUser is
// never called with attacker-controlled garbage.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import type { UserIdentity } from "@/lib/auth/types";
import { getOrderDetailForUser } from "@/lib/orders/queries";

type RouteContext = { params: Promise<{ uuid: string }> };

// RFC 4122 version-4 UUID (routes.py:150 FastAPI UUID param parity — Python's
// UUID type also rejects non-canonical ids before the handler runs).
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  let user: UserIdentity;
  try {
    user = await getCurrentUser(req);
  } catch (err) {
    // D-12 auth prologue — checkout route catch-block parity (route.ts:252-285).
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
    return NextResponse.json(
      { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
      { status: 500 },
    );
  }

  // Next 15/16 async params (same await style as /api/payment/pix/[txid]).
  const { uuid } = await ctx.params;

  // T-30-03-01: malformed ids 404 without any DB/query traffic.
  if (!UUID_V4_RE.test(uuid)) {
    return NextResponse.json(
      { error: "Pedido não encontrado", code: "ORDER_NOT_FOUND", retryable: false },
      { status: 404 },
    );
  }

  // Resolve the numeric user id from the identity uuid (checkout precedent).
  const dbUser = await prisma.user.findUnique({
    where: { uuid: user.uuid },
    select: { id: true },
  });
  if (!dbUser) {
    return NextResponse.json(
      { error: "Usuário não encontrado", code: "USER_NOT_FOUND", retryable: false },
      { status: 401 },
    );
  }

  const result = await getOrderDetailForUser(uuid, dbUser.id);

  switch (result.kind) {
    case "not_found":
      return NextResponse.json(
        { error: "Pedido não encontrado", code: "ORDER_NOT_FOUND", retryable: false },
        { status: 404 },
      );
    case "forbidden":
      // D-07: a foreign order is 403 (owner-vs-unknown discrimination).
      return NextResponse.json(
        { error: "Sem permissão para ver este pedido", code: "ORDER_FORBIDDEN", retryable: false },
        { status: 403 },
      );
    case "ok":
      if (result.order.expired) {
        // routes.py:188-193 parity — PENDING reservation past its window.
        return NextResponse.json(
          {
            error: "O prazo de reserva deste pedido expirou. Inicie um novo checkout.",
            code: "ORDER_EXPIRED",
            retryable: false,
          },
          { status: 410 },
        );
      }
      return NextResponse.json(result.order, { status: 200 });
  }
}