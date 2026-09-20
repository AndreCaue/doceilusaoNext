// Password hashing — bcryptjs port of Backend/app/auth/jwt.py pwd_context.
//
// passlib's CryptContext(schemes=["bcrypt"]) defaults to rounds=12; bcryptjs
// `bcrypt.hash(password, 12)` emits the same `$2b$12$...` format, so:
//   * NEW hashes are cost-identical to existing passlib ones (rounds 12), and
//   * EXISTING passlib hashes verify unchanged — users keep passwords across the
//     migration (AUTH-02, no password re-hash).
//
// bcrypt truncates input beyond 72 bytes silently — reject upstream (Threat
// T-26-01-02; also mirrors schemas.UserCreate max_length=72). Never log the
// plaintext or the hash.

import bcrypt from "bcryptjs";

const BCRYPT_MAX_BYTES = 72;
const BCRYPT_ROUNDS = 12;

/** Hash a plaintext password with bcrypt (rounds=12, $2b$ prefix, async API). */
export async function hashPassword(password: string): Promise<string> {
  const byteLength = new TextEncoder().encode(password).length;
  if (byteLength > BCRYPT_MAX_BYTES) {
    throw new Error("Senha muito longa (máximo de 72 bytes)");
  }
  // bcryptjs exposes a Promise-returning form (v3) — CPU-synchronous work is
  // wrapped so the event loop yields between hash operations.
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/** Verify a plaintext against an existing bcrypt hash (passlib $2b$ / $2a$ compatible). */
export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  const byteLength = new TextEncoder().encode(plain).length;
  if (byteLength > BCRYPT_MAX_BYTES) {
    // Same guard as hashPassword — an over-long input can never be a valid
    // password because it could never have been hashed successfully.
    return false;
  }
  return bcrypt.compare(plain, hashed);
}