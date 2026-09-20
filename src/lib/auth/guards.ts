// Server-side identity guards — port of `Backend/app/auth/dependencies.py`
// (get_token_from_request / get_current_user / get_current_user_optional /
// is_master_user / require_master_full_access) for AUTH-08 scope enforcement.
//
// Every protected /api/auth/* and admin route resolves identity through THIS
// module — the single server-side enforcement point (strangler-fig parity:
// same header-then-cookie order, same 401/403 semantics, same PT-BR messages
// as the Python backend, D-02 session compatibility).
//
// Token resolution order (dependencies.py:36-50):
//   1. Authorization header `Bearer <token>` (scheme case-insensitive)
//   2. access_token cookie fallback (dependencies.py:41)
//   → null if neither — the CALLER decides the 401 (getTokenFromRequest never
//     throws; getCurrentUser throws a typed AuthError).
//
// Error codes (Phase 25 D-12 shape `{ error, code, retryable: false }`):
//   missing token      → 401 "Não autenticado"                code UNAUTHORIZED
//   bad/expired/wrong  → 401 "Token inválido ou expirado"     code INVALID_TOKEN
//     type token        (thrown by jwt.ts decodeToken for signature/expiry,
//                        re-thrown here for the access-type/sub checks)
//   unknown user       → 401 "Usuário não encontrado"         code USER_NOT_FOUND
//   not master         → 403 "Acesso restrito a usuários master verificados."
//                                                             code FORBIDDEN
// HTTP parity note: the backend also emits `WWW-Authenticate: Bearer` on 401 —
// route handlers (plans 26-04..26-07) set that header when catching AuthError.
//
// Node-runtime only (imports Prisma + jwt.ts). Edge middleware stays jose-only
// (D-12) and must NOT import from here.

import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { ACCESS_COOKIE } from "@/lib/auth/cookies";
import { AuthError, decodeToken } from "@/lib/auth/jwt";
import type { UserIdentity } from "@/lib/auth/types";

/** Typed auth error — catch sites map it onto the D-12 response shape. */
export { AuthError };

type MasterCheckable = { role: string | null; scopes: unknown };

/**
 * Extract the bearer token — header first, cookie fallback (dependencies.py:36-50).
 * The Authorization scheme is matched case-insensitively (FastAPI's
 * get_authorization_scheme_param parity, Threat T-26-02-01): a non-Bearer
 * header NEVER wins over the cookie, and the cookie is NEVER preferred over a
 * valid Bearer header.
 *
 * Returns the raw token string, or null if neither source carries one.
 */
export function getTokenFromRequest(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    // FastAPI partition(" ") semantics: scheme = up to first space, param = rest.
    const [scheme, ...rest] = auth.trim().split(/\s+/);
    const token = rest.join(" ");
    if (scheme && scheme.toLowerCase() === "bearer" && token) {
      return token;
    }
  }
  return req.cookies.get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * Parse the DB scopes Json column into a string[] (defensive — a malformed
 * row must never crash identity resolution, cf. backend `(self.scopes or [])`).
 */
function scopesFromJson(scopes: unknown): string[] {
  return Array.isArray(scopes) ? scopes.filter((s): s is string => typeof s === "string") : [];
}

/**
 * Master-role check — port of `models.py:47-49` `is_master` property:
 * `role == "master"` AND `"master" in scopes`. Callers combine this with
 * `is_verified` where the backend requires it (dependencies.py:185-191).
 */
export function isMasterUser(user: MasterCheckable): boolean {
  return (
    user.role === "master" &&
    Array.isArray(user.scopes) &&
    user.scopes.includes("master")
  );
}

/**
 * Resolve the identity of the request's actor — port of dependencies.py
 * get_current_user (which composes get_token_from_request +
 * get_current_user_optional then 401s on null).
 *
 * Throws AuthError:
 *   - 401 "Não autenticado"                  — no token at all
 *   - 401 "Token inválido ou expirado"       — signature/expiry (jwt.ts),
 *                                              wrong claim type, or missing sub
 *   - 401 "Usuário não encontrado"           — token valid but user deleted
 *
 * Threat T-26-02-02: a refresh or password_reset token is NEVER accepted as a
 * session (`type === "access"` required), and a live DB row is required — the
 * token alone is never sufficient.
 */
export async function getCurrentUser(req: NextRequest): Promise<UserIdentity> {
  const token = getTokenFromRequest(req);
  if (!token) {
    throw new AuthError("Não autenticado", 401, "UNAUTHORIZED");
  }

  const payload = await decodeToken(token);
  if (payload.type !== "access" || !payload.sub) {
    throw new AuthError("Token inválido ou expirado", 401, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUnique({
    where: { email: payload.sub },
    select: {
      email: true,
      uuid: true,
      role: true,
      scopes: true,
      is_verified: true,
    },
  });
  if (!user) {
    throw new AuthError("Usuário não encontrado", 401, "USER_NOT_FOUND");
  }

  return {
    email: user.email,
    scopes: scopesFromJson(user.scopes),
    is_verified: user.is_verified === true,
    is_master: isMasterUser(user),
    uuid: user.uuid,
  };
}

/**
 * Optional identity — port of get_current_user_optional (dependencies.py:147-170).
 * Returns null on ANY failure (missing token, undecodable, wrong type, user
 * gone) — never throws. Same DB source of truth as getCurrentUser.
 */
export async function getCurrentUserOptional(req: NextRequest): Promise<UserIdentity | null> {
  try {
    return await getCurrentUser(req);
  } catch {
    return null;
  }
}

/**
 * Verified-master gate — port of require_master_full_access
 * (dependencies.py:193-202). Requires a valid session AND
 * `role === "master"` + `"master"` scope (via `user.is_master`, computed from
 * the DB row by isMasterUser in getCurrentUser) AND `is_verified === true`.
 *
 * Threat T-26-02-05: a revoked/ghost master account (role stripped, scope
 * removed, or verification revoked) cannot pass — the DB row is re-checked on
 * every call.
 */
export async function requireMasterFullAccess(req: NextRequest): Promise<UserIdentity> {
  const user = await getCurrentUser(req);
  if (!user.is_master || !user.is_verified) {
    throw new AuthError("Acesso restrito a usuários master verificados.", 403, "FORBIDDEN");
  }
  return user;
}