"use client";

// /verificar-email — client form over POST /api/auth/verify + resend
// (26-04), AUTH-05 + D-08.
//
// Contract honored:
//   * The email comes from ?email= (set by the login page's unverified-account
//     routing, 26-10) as CONTEXT TEXT ONLY — it is NEVER sent in the verify
//     body: the server derives the email from the access-token `sub`
//     (routes.py:99-108 parity). No editable email field (the email is bound
//     to the token).
//   * 6-digit code entry, maxLength 6 / minLength 4 — VerifyEmailRequest
//     4-10 parity (schemas.py:30). Numeric-only input.
//   * Submit → POST /api/auth/verify { code } with credentials: "include"
//     (D-01 cookie transport — no manual Authorization header).
//       - 200 { message: "E-mail verificado com sucesso!" } → /loja (D-06
//         default; verify mints NO cookies — the session comes from the
//         earlier login, routes.py:130-138).
//       - 401 → /login (no valid access token — the account must be logged in
//         before verifying, D-07 flow).
//       - 400 → inline the exact D-12 message ("Código incorreto" /
//         "Código expirado" / "Usuário inválido ou sem código de verificação"
//         — routes.py:109-128, never conflated into one message); the code
//         field stays focused.
//       - 429 → D-12 retryable rate message inline.
//   * "Reenviar código" → POST /api/auth/resend-verification with NO body
//     (the server reads the authenticated user from the token, routes.py:34-61).
//       - 200 → "Novo código enviado para o seu e-mail." (routes.py:61 exact).
//       - 400 "Conta já verificada." → /loja.
//       - 429 → "Aguarde antes de solicitar um novo código." inline; the 60s
//         client countdown keeps the button disabled (the countdown is UX only
//         — the server backs it with the 3/min rate + 1-min cool-down, never a
//         security claim).
//   * Errors render as text nodes ({error}) — never dangerouslySetInnerHTML
//     with response-controlled strings (T-26-11-05).

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RESEND_COOLDOWN_SECONDS = 60;
const RATE_MESSAGE = "Muitas tentativas. Tente novamente em instantes.";

function VerifyEmailForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // CONTEXT ONLY — display of the account email (never sent in the body).
  const email = searchParams.get("email") ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Next 15 cannot export `metadata` from a "use client" page (build error),
  // and the (auth) layout serves both pages — set the per-page title directly.
  useEffect(() => {
    document.title = "Verificar E-mail | Doce Ilusão";
  }, []);

  // 60s client-side cooldown between resends (UX only — the server enforces
  // the 3/min rate + 1-min cool-down on its own, routes.py:35/45-53).
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const startCountdown = useCallback(() => {
    setCountdown(RESEND_COOLDOWN_SECONDS);
  }, []);

  // Numeric-only code entry — strip anything that is not a digit on input.
  function handleCodeChange(value: string) {
    setCode(value.replace(/\D/g, ""));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading || code.length < 4 || code.length > 6) return;
    setError(null);
    setResendMessage(null);
    setIsLoading(true);

    try {
      // NO email in the body — the server derives it from the access token
      // (routes.py:99-108 parity).
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        // D-06: already logged in from the earlier login — verify mints no
        // session (routes.py:130-138), straight to the store.
        router.push("/loja");
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.status === 401) {
        // No valid access token — the account must be logged in before
        // verifying (D-07 flow).
        router.push("/login");
        return;
      }

      if (res.status === 429) {
        setError(RATE_MESSAGE);
      } else {
        // 400s: exact parity messages — "Código incorreto" (routes.py:119),
        // "Código expirado" (routes.py:128), "Usuário inválido ou sem código
        // de verificação" (routes.py:112). Never conflated.
        setError(body?.error ?? "Não foi possível verificar o código. Tente novamente.");
      }

      // Keep the code field focused after a failure — the user is mid-entry.
      codeInputRef.current?.focus();
    } catch {
      setError("Não foi possível verificar o código. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResend() {
    if (isResending || countdown > 0) return;
    setError(null);
    setResendMessage(null);
    setIsResending(true);

    try {
      // NO body — the server reads the authenticated user from the token
      // (routes.py:34-61 parity).
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
      });

      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.ok) {
        // routes.py:61 exact text.
        setResendMessage("Novo código enviado para o seu e-mail.");
        startCountdown();
        return;
      }

      if (res.status === 400 && body?.error === "Conta já verificada.") {
        // Already-verified user — nothing to verify; the session is live.
        router.push("/loja");
        return;
      }

      if (res.status === 429) {
        // "Aguarde antes de solicitar um novo código." (cool-down, routes.py:
        // 52) or the 3/min D-12 rate message — both keep the countdown.
        setError(body?.error ?? RATE_MESSAGE);
        return;
      }

      if (res.status === 401) {
        router.push("/login");
        return;
      }

      setError(body?.error ?? "Não foi possível reenviar o código. Tente novamente.");
    } catch {
      setError("Não foi possível reenviar o código. Tente novamente.");
    } finally {
      setIsResending(false);
    }
  }

  return (
    <>
      <h2 className="mb-6 text-center text-xl font-semibold">Verificar e-mail</h2>

      <p className="mb-6 text-center text-sm text-muted-foreground">
        Enviamos um código de 6 dígitos para{" "}
        <span className="font-medium text-foreground">{email}</span>. Digite-o
        abaixo para confirmar sua conta.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Código de verificação</Label>
          <Input
            ref={codeInputRef}
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            minLength={4}
            required
            background="light"
            placeholder="••••••"
            aria-label="Código de verificação"
            className="text-center text-lg tracking-[0.5em]"
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            código com 4 a 6 dígitos
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        {resendMessage && (
          <p role="status" className="text-sm font-medium text-emerald-600">
            {resendMessage}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading || code.length < 4}>
          {isLoading ? "Confirmando..." : "Confirmar"}
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleResend}
          disabled={isResending || countdown > 0}
        >
          {countdown > 0
            ? `Reenviar código em ${countdown}s`
            : isResending
              ? "Reenviando..."
              : "Reenviar código"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Não recebeu? Aguarde 1 minuto antes de solicitar outro código.
        </p>
      </div>
    </>
  );
}

// Suspense boundary: useSearchParams must be under one during static
// prerendering in Next 15 (build-time requirement, dev unaffected).
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  );
}