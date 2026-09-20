// Payment App Router route helpers (Plan 29-05).
//
// The shared payment libs (plans 29-02..29-04) ship the business logic; the
// App Router route handlers were deferred ("route.ts entries deferred to
// 29-05/29-06" — 29-04 SUMMARY). These helpers keep the four /api/payment/*
// handlers thin and consistent: auth resolution (D-02 guards parity), numeric
// user id for IDOR checks, and the D-12 error → HTTP response mapping.
//
// SERVER-ONLY (D-05) — never import from a client component.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AuthError, getCurrentUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import type { EfiError } from "@/lib/payments/types";
import type { UserIdentity } from "@/lib/auth/types";

/** Resolve the request actor (throws AuthError — guards.ts D-02 parity). */
export function requireAuth(req: NextRequest): Promise<UserIdentity> {
  return getCurrentUser(req);
}

/**
 * Numeric user id for ownership checks (checkout/[uuid]/page.tsx precedent —
 * Order.user_id is an int FK; the JWT sub is the email).
 */
export async function resolveDbUserId(userUuid: string): Promise<number | null> {
  const dbUser = await prisma.user.findUnique({
    where: { uuid: userUuid },
    select: { id: true },
  });
  return dbUser?.id ?? null;
}

/** 401 + WWW-Authenticate: Bearer (guards.ts parity header). */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Não autenticado", code: "UNAUTHORIZED", retryable: false },
    { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
  );
}

/** Route input validation failure — D-12 shape, PT-BR. */
export function invalidRequestResponse(message = "Requisição inválida"): NextResponse {
  return NextResponse.json(
    { error: message, code: "INVALID_REQUEST", retryable: false },
    { status: 400 },
  );
}

/**
 * D-12 error → HTTP response. AuthError (guards) and EfiError (payment libs)
 * carry the PT-BR message + stable code; an unknown error is a generic 500.
 */
export function paymentErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json(
      { error: err.message, code: err.code, retryable: err.retryable },
      {
        status: err.status,
        headers: err.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      },
    );
  }
  const efi = err as EfiError | undefined;
  if (efi && typeof efi.error === "string" && typeof efi.code === "string") {
    return NextResponse.json(
      { error: efi.error, code: efi.code, retryable: efi.retryable === true },
      { status: efiStatusCode(efi.code) },
    );
  }
  return NextResponse.json(
    { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
    { status: 500 },
  );
}

/** Efí/domain error code → HTTP status (text stays in the libs, T-25-03). */
function efiStatusCode(code: string): number {
  switch (code) {
    case "ORDER_NOT_FOUND":
    case "CHARGE_NOT_FOUND":
      return 404;
    case "PAYMENT_EXPIRED":
    case "PAYMENT_ALREADY_PAID":
      return 409;
    case "EFI_INVALID_CARD":
      return 422;
    case "EFI_INVALID_REQUEST":
    case "BUYER_INCOMPLETE":
      return 400;
    case "EFI_RATE_LIMITED":
      return 429;
    case "EFI_UNAUTHORIZED":
    case "EFI_SERVER_ERROR":
      return 502;
    case "EFI_UNREACHABLE":
      return 503;
    default:
      return 500;
  }
}