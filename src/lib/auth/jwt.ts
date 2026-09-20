// JWT mint/verify + refresh-token DB helpers — jose port of Backend/app/auth/jwt.py.
//
// Claim formats (D-02 parity, HS256, shared SECRET_KEY — tokens minted here decode
// in the Python backend and vice versa):
//   access:  { sub: <email>, scopes: string[], exp, iat, type: "access" }
//   refresh: { sub: <email>, exp, iat, type: "refresh", jti: <uuid4> }
//   reset:   { sub: <user_uuid>, exp, iat, type: "password_reset" }
//
// Typed errors carry a `status` field (401/400/500) so route handlers map them
// directly onto the Phase 25 D-12 error shape `{ error, code, retryable }`.
//
// NOTE: this module imports Prisma — Node-runtime only. Edge middleware stays
// jose-only (D-12) and must NOT import from here.

import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import { prisma } from "@/lib/prisma";

import { ACCESS_TOKEN_EXPIRE_MINUTES, requireAuthSecret } from "@/lib/auth/config";
import type { AuthTokenPayload } from "@/lib/auth/types";

// ─── Typed errors (status for direct route mapping) ────────────

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code: string, retryable = false) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// ─── Token minting ──────────────────────────────────────────────

const encoder = new TextEncoder();
const ALGORITHM = "HS256";

/** Mint an access token — `{ sub: email, scopes, type: "access" }`, 30min TTL. */
export async function createAccessToken(params: {
  email: string;
  scopes: string[];
}): Promise<string> {
  const secret = requireAuthSecret();
  return new SignJWT({ scopes: params.scopes, type: "access" })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(params.email)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_EXPIRE_MINUTES}m`)
    .sign(encoder.encode(secret));
}

/** Mint a refresh token — `{ sub: email, type: "refresh", jti }`, 30d TTL. */
export async function createRefreshToken(params: { email: string }): Promise<string> {
  const secret = requireAuthSecret();
  return new SignJWT({ type: "refresh" })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(params.email)
    .setIssuedAt()
    .setExpirationTime("30d")
    .setJti(randomUUID())
    .sign(encoder.encode(secret));
}

/** Mint a password-reset token — `{ sub: user_uuid, type: "password_reset" }`, 30min TTL (D-09). */
export async function createResetPasswordToken(userUuid: string): Promise<string> {
  const secret = requireAuthSecret();
  return new SignJWT({ type: "password_reset" })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userUuid)
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(encoder.encode(secret));
}

// ─── Verification ───────────────────────────────────────────────

/**
 * Verify a token's HS256 signature and return its payload.
 * Callers MUST check `payload.type` against the expected claim (backend
 * routes.py parity — verify checks `type != "access"`, refresh checks
 * `type != "refresh"`).
 */
export async function decodeToken(token: string): Promise<AuthTokenPayload> {
  const secret = requireAuthSecret();
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: [ALGORITHM],
    });
    return payload as AuthTokenPayload;
  } catch {
    throw new AuthError("Token inválido ou expirado", 401, "INVALID_TOKEN");
  }
}

/** Verify a password-reset token — requires `type === "password_reset"`, returns the user_uuid (sub). */
export async function verifyResetPasswordToken(token: string): Promise<string> {
  const payload = await decodeToken(token);
  if (payload.type !== "password_reset") {
    throw new AuthError("Token inválido", 400, "INVALID_TOKEN");
  }
  if (!payload.sub) {
    throw new AuthError("Token inválido", 400, "INVALID_TOKEN");
  }
  return payload.sub;
}

// ─── Refresh-token DB helpers (Prisma, refresh_tokens table) ────

/** Persist a minted refresh token (jti unique in schema, Threat T-26-01-03). */
export async function saveRefreshToken(params: {
  jti: string;
  userId: number;
  expiresAt: Date;
}): Promise<void> {
  await prisma.refreshToken.create({
    data: {
      jti: params.jti,
      user_id: params.userId,
      expires_at: params.expiresAt,
      revoked: false,
    },
  });
}

/**
 * Revoke a single refresh token by jti.
 * updateMany (not update) keeps backend tolerance — no-op when the jti was
 * already cleaned (backend jwt.py `if db_token` guard parity).
 */
export async function revokeRefreshToken(jti: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { jti },
    data: { revoked: true },
  });
}

/** True when the jti belongs to the user and is neither revoked nor expired (Threat T-26-01-03). */
export async function isRefreshTokenValid(params: {
  jti: string;
  userId: number;
}): Promise<boolean> {
  const found = await prisma.refreshToken.findFirst({
    where: {
      jti: params.jti,
      user_id: params.userId,
      revoked: false,
      expires_at: { gt: new Date() },
    },
  });
  return found !== null;
}

/** Revoke every active refresh token for a user — logout path (D-14, improvement over clear-cookies-only). */
export async function revokeAllUserRefreshTokens(userId: number): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { user_id: userId, revoked: false },
    data: { revoked: true },
  });
}