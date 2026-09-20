"use client";

// /login — client form over POST /api/auth/token (26-05), AUTH-02 + D-06.
//
// Contract honored:
//   * OAuth2PasswordRequestForm parity — the page POSTs urlencoded
//     username=<email>&password=<pw> (the SPA's auth.ts posts URLSearchParams
//     too) so the 26-05 route answers without a shape mismatch.
//   * Cookie transport (D-01): credentials: "include", NO manual Authorization
//     header, NO localStorage token (T-26-10-01).
//   * 200: reads body.is_verified — the backend does NOT gate login on
//     verification (routes.py:203-209 has no is_verified check) and the SAME
//     response carries the flag: unverified → /verificar-email?email=… (D-04/
//     D-07); verified → ?redirect= honored ONLY for same-origin relative
//     targets (T-26-08-05 / T-26-10-02); when redirect is absent/unsafe the
//     default is now SCOPE-AWARE — user-driven deviation from D-06 at the
//     26-10 checkpoint: body.scopes containing "master" → /admin/loja,
//     everyone else → /loja (D-06's plain default).
//   * 401 "Credenciais inválidas" / 429 D-12 rate message / other D-12
//     { error, code, retryable } bodies — all rendered inline, no reload.
//     There is NO 403 EMAIL_NOT_VERIFIED branch in the backend — none here.
//   * Errors render as text nodes ({error}) — never dangerouslySetInnerHTML
//     with response-controlled strings (T-26-10-05).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Same-origin redirect guard (T-26-10-02 / T-26-08-05): honor ONLY relative
 * targets — must start with "/", and NOT "//" (protocol-relative) nor "/\"
 * (backslash URL-normalization bypass). Anything else falls back to D-06.
 */
function isSafeRedirect(raw: string | null): raw is string {
  if (!raw || raw.length === 0) return false;
  if (!raw.startsWith("/")) return false;
  if (raw.startsWith("//")) return false;
  if (raw.startsWith("/\\")) return false;
  return true;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Next 15 cannot export `metadata` from a "use client" page (build error),
  // and the (auth) layout serves both pages — set the per-page title directly.
  useEffect(() => {
    document.title = "Login | Doce Ilusão";
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "include",
        // Mirror the route-side normalization (token/route.ts lowercases the
        // username lookup) so the posted form value matches the stored form.
        body: new URLSearchParams({ username: email.toLowerCase(), password }),
      });

      if (res.ok) {
        const body = (await res.json().catch(() => null)) as {
          is_verified?: boolean;
          scopes?: string[];
        } | null;

        // Unverified account → verification is the next step (D-07). The login
        // itself already succeeded (cookies set) — no 403 branch to handle.
        // The redirect param carries the NORMALIZED email (mirrors the :75
        // email.toLowerCase() post) so the verificar-email page displays the
        // same spelling as the stored (lowercased) account email shown in the
        // verification email itself.
        if (body?.is_verified === false) {
          router.push(
            `/verificar-email?email=${encodeURIComponent(email.toLowerCase())}`,
          );
          return;
        }

        // ?redirect= (T-26-08-05) keeps priority when present and safe —
        // any scope, including master, honors it.
        const rawRedirect = searchParams.get("redirect");
        if (isSafeRedirect(rawRedirect)) {
          router.push(rawRedirect);
          return;
        }

        // Scope-aware default (user-driven deviation from D-06 at the 26-10
        // checkpoint): the token body carries scopes (routes.py:211-213) —
        // master-scope users land on /admin/loja, everyone else on /loja.
        const scopes = Array.isArray(body?.scopes) ? body.scopes : [];
        router.push(scopes.includes("master") ? "/admin/loja" : "/loja");
        return;
      }

      // D-12 error shape — parity inline messages (no reload): 401 exact text,
      // 429 exact D-12 rate message, everything else error.message fallback.
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.status === 401) {
        setError("Credenciais inválidas");
      } else if (res.status === 429) {
        setError("Muitas tentativas. Tente novamente em instantes.");
      } else {
        setError(body?.error ?? "Não foi possível entrar. Tente novamente.");
      }
    } catch {
      setError("Não foi possível entrar. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <h2 className="mb-6 text-center text-xl font-semibold">Entrar</h2>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            background="light"
            placeholder="seu@email.com"
            aria-label="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            background="light"
            placeholder="••••••••"
            aria-label="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? "Entrando..." : "Entrar"}
        </Button>

        <div className="flex flex-col gap-4 text-center text-sm">
          <Link
            href="/esqueci-senha"
            className="text-muted-foreground transition-colors hover:text-primary"
          >
            Esqueci sua senha?
          </Link>
          <p className="text-muted-foreground">
            Não tem uma conta?{" "}
            <Link
              href="/cadastro"
              className="font-medium text-primary hover:underline"
            >
              Criar conta
            </Link>
          </p>
        </div>
      </form>
    </>
  );
}

// Suspense boundary: useSearchParams must be under one during static
// prerendering in Next 15 (build-time requirement, dev unaffected).
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
