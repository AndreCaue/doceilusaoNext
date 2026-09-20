// GET /api/orders/by-user — active-reservation gate (Plan 30-03, ORDER-02).
//
// Parity: `Backend/app/store/orders/routes.py:20-89` GET /orders/by-user —
// HasOrderDetail shape; "Nunca retorna erro" (routes.py:20) holds at the ROUTE
// level too: any getActiveReservation failure degrades to the NO_ORDER 200
// (the lib already never throws; this route defends the HTTP boundary).
//
// Auth: getCurrentUser → 401 D-12 (checkout-route prologue parity), then the
// numeric Prisma user id is resolved from the identity uuid (checkout
// route.ts:95-98 precedent — Order.user_id is an int FK, the JWT sub is email).
//
// Threat T-30-03-02: the NO_ORDER shape is the ONLY failure response for the
// reservation read — never stack traces, never query details.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import type { UserIdentity } from "@/lib/auth/types";
import { getActiveReservation, type HasOrderResult } from "@/lib/orders/queries";

const NO_ORDER: HasOrderResult = {
  success: false,
  message: "",
  redirect: null,
  expires_at: 0,
  expires_at_iso: null,
};

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

  // routes.py:88 parity — the reservation read NEVER returns an error shape.
  let result: HasOrderResult;
  try {
    result = await getActiveReservation(dbUser.id);
  } catch {
    result = NO_ORDER;
  }

  return NextResponse.json(result, { status: 200 });
}