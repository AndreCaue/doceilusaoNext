// POST /api/auth/token — port of Backend/app/auth/routes.py:195-265 (login).
//
// Explicit route: shadows the Phase 25 catch-all proxy for /api/auth/token.
// Prisma-direct login — no Python hop.
//
// Behavior parity (AUTH-02, D-01/D-02/D-03):
//   * OAuth2 form contract: Content-Type application/x-www-form-urlencoded,
//     body username=<email>&password=<pw> — the SPA posts URLSearchParams
//     (Frontend/src/Repositories auth.ts:11-19) — KEEP form-encoded
//   * find user by email + verifyPassword (bcrypt rounds 12) → generic 401
//     "Credenciais inválidas" (no user enumeration — Threat T-26-05-01)
//   * scopes normalized: JSON array as-is; "a,b" string → split(",")
//     (routes.py:211-213 — JSON column may hold either)
//   * mints access + refresh JWTs (jose, shared SECRET_KEY — D-02); refresh
//     jti + exp persisted to refresh_tokens via saveRefreshToken
//   * BOTH cookies set (D-01): access_token + refresh_token, httpOnly,
//     samesite=lax, path=/, domain=.doceilusao.store in prod, maxAge 30d
//     (D-03 supersedes the backend's 7d login inconsistency at routes.py:252 —
//     the refresh ROUTE already uses 30d at :387)
//   * 200 body: Token shape { access_token, token_type, scopes, is_verified,
//     is_master ONLY when role === "master" && "master" in scopes }
//
// Rate limit: token 10/min per route+IP (routes.py:196 parity).
// Error contract: Phase 25 D-12 shape { error, code, retryable }.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { setAuthCookies } from "@/lib/auth/cookies";
import {
  AuthError,
  createAccessToken,
  createRefreshToken,
  decodeToken,
  saveRefreshToken,
} from "@/lib/auth/jwt";
import { ip } from "@/lib/auth/ip";
import { verifyPassword } from "@/lib/auth/password";
import { RATE_LIMITS, rateLimit } from "@/lib/auth/rate-limit";

function errorResponse(message: string, code: string, status: number, retryable = false) {
  return NextResponse.json({ error: message, code, retryable }, { status });
}

export async function POST(req: NextRequest) {
  try {
    // OAuth2PasswordRequestForm parity — FastAPI rejects non-form content with
    // 422; we map to the D-12 400 shape (the SPA always sends urlencoded).
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("application/x-www-form-urlencoded")) {
      return errorResponse(
        "Content-Type deve ser application/x-www-form-urlencoded",
        "BAD_REQUEST",
        400,
      );
    }

    // Body parse — form fields username/password (OAuth2PasswordRequestForm).
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return errorResponse("Formulário inválido", "BAD_REQUEST", 400);
    }

    const username = form.get("username");
    const password = form.get("password");
    // urlencoded body → both are strings; File values can never satisfy this.
    if (typeof username !== "string" || typeof password !== "string" || username === "" || password === "") {
      return errorResponse("Username e senha são obrigatórios", "BAD_REQUEST", 400);
    }

    // Rate limit BEFORE credential work (brute-force abatement, T-26-05-01).
    const rl = rateLimit(`token:${ip(req)}`, RATE_LIMITS.token);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: "Muitas tentativas. Tente novamente em instantes.",
          code: "RATE_LIMITED",
          retryable: true,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSeconds) },
        },
      );
    }

    // Credential check — routes.py:205-209. Same message for unknown user and
    // wrong password (no user enumeration, Threat T-26-05-01). The lookup
    // LOWERCASES the submitted email to match the write-boundary normalization
    // (register/route.ts:87 stores email.toLowerCase()).
    //
    // Collision handling: the email column is a case-sensitive unique index,
    // so a lowercased twin can coexist with a legacy mixed-case row (the
    // population the iter-2 insensitive lookups targeted). EXACT match FIRST
    // (deterministic — the twin owner verifies their password against their
    // own row), then mode-insensitive fallback ONLY when no exact row exists
    // (keeps pre-normalization legacy rows reachable). A plain findFirst with
    // mode: "insensitive" alone would resolve indeterminately by heap scan
    // order when twins exist and shadow one of the owners. findFirst (not
    // findUnique) is required: findUnique only accepts scalar equality on the
    // unique email field.
    const lowered = username.toLowerCase();
    const user =
      (await prisma.user.findFirst({ where: { email: lowered } })) ??
      (await prisma.user.findFirst({
        where: { email: { equals: lowered, mode: "insensitive" } },
      }));
    if (!user || !(await verifyPassword(password, user.password))) {
      return errorResponse("Credenciais inválidas", "INVALID_CREDENTIALS", 401);
    }

    // Scopes normalization — routes.py:211-213 (JSON column: array OR string).
    const rawScopes = user.scopes;
    const scopes = Array.isArray(rawScopes)
      ? rawScopes.filter((s): s is string => typeof s === "string")
      : typeof rawScopes === "string"
        ? rawScopes.split(",").filter(Boolean)
        : [];

    // Mint pair — routes.py:215-228 (access 30min, refresh 30d TTL).
    const accessToken = await createAccessToken({ email: user.email, scopes });
    const refreshToken = await createRefreshToken({ email: user.email });

    // Persist the refresh token — decode to extract jti + exp (routes.py:230-241).
    let jti: string;
    let expiresAt: Date;
    try {
      const payload = await decodeToken(refreshToken);
      if (!payload.jti || !payload.exp) {
        throw new Error("refresh token sem jti/exp");
      }
      jti = payload.jti;
      expiresAt = new Date(payload.exp * 1000);
    } catch {
      return errorResponse("Erro ao gerar refresh token", "INTERNAL_ERROR", 500, true);
    }

    try {
      await saveRefreshToken({ jti, userId: user.id, expiresAt });
    } catch {
      // jti collision or DB failure — do not hand out an unpersisted refresh
      // token (a refresh would 401 "revogado ou expirado" later).
      return errorResponse("Erro ao gerar refresh token", "INTERNAL_ERROR", 500, true);
    }

    // is_master — routes.py:262-264 parity: role master AND master scope.
    const isMaster = user.role === "master" && scopes.includes("master");

    const tokenResponse = {
      access_token: accessToken,
      token_type: "bearer" as const,
      scopes,
      is_verified: user.is_verified === true,
      ...(isMaster ? { is_master: true } : {}),
    };

    // D-01: body (legacy SPA Bearer flow) AND both cookies (D-02 names, D-03
    // attributes — httpOnly/secure-prod/lax/path=/30d).
    const response = new NextResponse(JSON.stringify(tokenResponse), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
    setAuthCookies(response, { accessToken, refreshToken });
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      return errorResponse(err.message, err.code, err.status, err.retryable);
    }
    return errorResponse("Erro interno", "INTERNAL_ERROR", 500, true);
  }
}