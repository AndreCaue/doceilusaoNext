// PUT /api/auth/upgrade — port of Backend/app/auth/routes.py:282-299
// (upgrade_user_to_premium).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/upgrade.
// Prisma-direct single-writer (26-CONTEXT OpenCode discretion — the endpoint is
// master-gated and small; the auth flow has one writer: this route).
//
// Behavior parity (AUTH-09, T-26-07-01):
//   * `requireMasterFullAccess(req)` — role master + "master" scope +
//     is_verified (dependencies.py:193-202 parity); failure → 403 "Acesso
//     restrito a usuários master verificados." BEFORE any read or write
//   * JSON body `{ user_uuid: string }` (UpgradeUserRequest, routes.py:278-279);
//     malformed/missing → 400 D-12 (FastAPI ValidationError parity)
//   * `prisma.user.findUnique({ where: { uuid } })` → 404 "Usuário não
//     encontrado" (routes.py:291-292)
//   * idempotent grant (T-26-07-02): target scopes normalized (array | "a,b"
//     string); "premium" appended ONLY when absent (routes.py:294-297) —
//     concurrent duplicate PUTs cannot duplicate the scope
//   * 200 → { message: `Usuário ${email} agora é premium!`, scopes } (routes.py:299)
//   * role untouched; tokens NOT rewritten — the grant takes effect on next
//     token issuance (routes.py:294-297 parity; the provider refreshes scopes
//     on next /me or refresh, T-26-07-03 accepted)
//
// Error contract: D-12 shape { error, code, retryable }; 401s carry
// `WWW-Authenticate: Bearer` (backend parity, guards.ts contract).
//
// NOTE: no rate limit — the backend route has none (routes.py:282-299) and
// access is restricted to verified masters (per-instance abatement for
// unauthenticated floods is covered by the other routes' limiters).

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireMasterFullAccess } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";

/** Normalize the DB scopes JSON column — array | "a,b" string → string[] (routes.py:211-213 parity). */
function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((s): s is string => typeof s === "string");
  }
  if (typeof raw === "string") {
    return raw.split(",").filter(Boolean);
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

export async function PUT(req: NextRequest) {
  try {
    // Master gate BEFORE any read/write (T-26-07-01, dependencies.py:193-202
    // parity) — a non-master NEVER reaches the user query.
    await requireMasterFullAccess(req);

    // Body parse — malformed JSON → 400 D-12 (UpgradeUserRequest parity: the
    // backend 422s; routes map FastAPI validation to the D-12 400 shape).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("JSON inválido", "BAD_REQUEST", 400);
    }

    const userUuid =
      typeof body === "object" && body !== null ? (body as { user_uuid?: unknown }).user_uuid : undefined;

    // UpgradeUserRequest parity: user_uuid required, non-empty string.
    if (typeof userUuid !== "string" || userUuid === "") {
      return errorResponse("user_uuid é obrigatório", "BAD_REQUEST", 400);
    }

    // Target user lookup — routes.py:289-292. 404 when the uuid matches no row.
    const target = await prisma.user.findUnique({
      where: { uuid: userUuid },
      select: { id: true, email: true, scopes: true },
    });
    if (!target) {
      return errorResponse("Usuário não encontrado", "NOT_FOUND", 404);
    }

    // Idempotent grant (routes.py:294-297, T-26-07-02): append "premium" only
    // when absent. Concurrent duplicate PUTs both see "premium" missing, but
    // both write the same resulting array — no duplication possible.
    const scopes = normalizeScopes(target.scopes);
    let updatedScopes = scopes;
    if (!scopes.includes("premium")) {
      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { scopes: [...scopes, "premium"] },
        select: { scopes: true },
      });
      updatedScopes = normalizeScopes(updated.scopes);
    }

    // routes.py:299 parity — message + fresh scopes. Role untouched; tokens
    // NOT rewritten (grant takes effect on next issuance, T-26-07-03).
    return NextResponse.json(
      {
        message: `Usuário ${target.email} agora é premium!`,
        scopes: updatedScopes,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof AuthError) {
      // requireMasterFullAccess → 401 (identity) or 403 (non-master) — 401s
      // carry WWW-Authenticate (guards.ts contract).
      if (err.status === 401) {
        return unauthorizedResponse(err.message, err.code);
      }
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}