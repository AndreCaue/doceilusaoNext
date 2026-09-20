// GET /api/orders/list — order history feed (Plan 30-03, ORDER-01).
//
// Parity: `Backend/app/store/orders/routes.py:92-147` GET /orders/list —
// OrderListItemOut array shape, consumed by plan 30-04's OrdersTable as
// `{ orders: OrderListItem[] }` (created_at DESC is the lib's job).
//
// Never 500: any listOrdersByUser failure degrades to `{ orders: [] }` —
// the history screen keeps working under DB hiccups (T-30-03-03 accept:
// bounded by the user's own order count; read-only, Prisma parameterized).
//
// Auth: getCurrentUser → 401 D-12 + numeric id resolution (checkout
// route.ts:95-98 precedent, same as the by-user route).

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import type { UserIdentity } from "@/lib/auth/types";
import { listOrdersByUser, type OrderListItem } from "@/lib/orders/queries";

export async function GET(req: NextRequest): Promise<NextResponse> {
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

  let orders: OrderListItem[];
  try {
    orders = await listOrdersByUser(dbUser.id);
  } catch {
    orders = [];
  }

  return NextResponse.json({ orders }, { status: 200 });
}