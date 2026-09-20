"use client";

// Real auth provider (D-15) — replaces the provisional Phase 26 useAuth.
// Consumed by Topbar, UserTopbar, Sidebar and the (admin) layout; the
// consumer contract (`user`, `isGuest`, `logout`) is preserved drop-in and
// extended additively with `isLoading`.
//
// Contract:
//   * on mount → GET /api/auth/me (credentials cookie transport, D-01 — no
//     Authorization header, no localStorage token) → 200 resolves identity;
//     401 → POST /api/auth/refresh ONCE (client-initiated rotation, D-13) →
//     200 → retry /me with the rotated cookies; repeated 401 → guest.
//   * logout() → POST /api/auth/logout (server revokes refresh tokens + clears
//     cookies, D-14) then clears local state unconditionally — the UI can
//     never show a logged-in shell after a failed/canceled logout.
//   * identity lives only in React memory (T-26-09-05 accepted): nothing is
//     persisted to localStorage; if the cookies expire the session dies with
//     the tab's JS context.
//
// No focus/revalidate listener by design — mount-time resolve + 401-refresh is
// the D-15/D-13 contract; Phase 28+ consumers call /api/auth/refresh
// themselves when OTHER fetches receive 401.

import { useCallback, useEffect, useState } from "react";

export type AuthUser = {
  email: string;
  scopes: string[];
  isVerified: boolean;
  isMaster: boolean;
};

export type TAuth = {
  user: AuthUser | null;
  isGuest: boolean;
  isLoading: boolean;
  logout: () => Promise<void>;
};

/**
 * Whitelist-validate an unknown /me response body before it reaches React
 * state (T-26-09-04 — no raw injection; only the four known fields are
 * read, booleans coerced). Returns null for anything unexpected.
 */
function parseMePayload(raw: unknown): AuthUser | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  if (typeof body.email !== "string" || body.email.length === 0) return null;
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === "string")
    : [];
  return {
    email: body.email,
    scopes,
    isVerified: body.is_verified === true,
    isMaster: body.is_master === true,
  };
}

const useAuth = (): TAuth => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Mount-time identity resolution (D-15 + D-13 client-initiated refresh):
  //   GET /me → 200: identity resolved
  //            401: refresh ONCE → retry /me once → 200/401 (no loop,
  //                 T-26-09-02 — repeated 401 = guest, no session)
  //  network error / other status: guest + console.error (never throw into
  //  React)
  useEffect(() => {
    let active = true;

    const resolveIdentity = async (): Promise<void> => {
      const me = await fetch("/api/auth/me", {
        credentials: "include",
        cache: "no-store",
      });

      if (me.ok) {
        const payload = parseMePayload(await me.json().catch(() => null));
        if (active) setUser(payload);
        return;
      }

      if (me.status === 401) {
        // Client-initiated refresh rotation (D-13) — exactly once per mount.
        const refresh = await fetch("/api/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
        if (refresh.ok) {
          // Rotated cookies now authenticate — retry /me once (D-15 chain).
          const retried = await fetch("/api/auth/me", {
            credentials: "include",
            cache: "no-store",
          });
          if (retried.ok) {
            const payload = parseMePayload(await retried.json().catch(() => null));
            if (active) setUser(payload);
            return;
          }
        }
        // Repeated 401 (or failed refresh) → guest — bounded, no loop.
        if (active) setUser(null);
        return;
      }

      // Non-401 error (5xx etc.) → no identity to display → guest.
      if (active) setUser(null);
    };

    (async () => {
      try {
        await resolveIdentity();
      } catch (err) {
        // Network error / malformed response — guest, do not throw into React.
        console.error("[useAuth] falha ao resolver identidade em /auth/me", err);
        if (active) setUser(null);
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Server-side session termination (D-14) + unconditional local clear
  // (T-26-09-03). Consumers call logout() without awaiting — a Promise return
  // is source-compatible; the hook never rejects (network errors are caught
  // here, not propagated as unhandled rejections).
  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (err) {
      // Network failure — server may or may not have revoked; local state is
      // cleared regardless (idempotent logout UX, D-14).
      console.error("[useAuth] falha ao chamar /auth/logout", err);
    } finally {
      setUser(null);
      setIsLoading(false);
    }
  }, []);

  return {
    user,
    isGuest: user === null,
    isLoading,
    logout,
  };
};

export { useAuth };