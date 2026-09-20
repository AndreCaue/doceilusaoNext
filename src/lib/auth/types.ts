// Shared auth types — token claim format parity with the Python backend.
//
// Payload shapes mirror `Backend/app/auth/jwt.py` (token claims) and
// `Backend/app/schemas.py` Token/UserOut. Every auth module (routes,
// middleware, provider, pages) imports from here — never re-declares.
//
// verbatimModuleSyntax: all type-only exports use `export type`.

/** JWT payload claims — HS256, shared SECRET_KEY (D-02). */
export type AuthTokenPayload = {
  sub: string;
  scopes?: string[];
  type: "access" | "refresh" | "password_reset";
  exp?: number;
  iat?: number;
  jti?: string;
};

/** Body of POST /auth/token and POST /auth/refresh — mirrors schemas.Token. */
export type AccessTokenResponse = {
  access_token: string;
  token_type: "bearer";
  scopes: string[];
  is_verified: boolean;
  is_master?: boolean;
};

/** Identity returned by GET /auth/me — mirrors schemas.UserOut / routes.py:524-531. */
export type UserIdentity = {
  email: string;
  scopes: string[];
  is_verified: boolean;
  is_master: boolean;
  uuid: string;
};

/** Refresh-token DB row shape (prisma.refreshToken, @map "refresh_tokens"). */
export type RefreshTokenRow = {
  jti: string;
  userId: number;
  expiresAt: Date;
  revoked: boolean;
};