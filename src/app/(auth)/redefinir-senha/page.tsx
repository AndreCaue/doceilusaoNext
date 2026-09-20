"use client";

// /redefinir-senha — client form over POST /api/auth/reset-password (26-06),
// AUTH-07 + D-09/D-11.
//
// Contract honored:
//   * Token comes from ?token= (D-09 reset link — signed JWT via jose, 30-min
//     expiry, sub = user_uuid). It is ONLY read from the URL param; never
//     typed, never stored in state/localStorage, never logged (T-26-11-02,
//     T-26-11-03).
//   * Token absent → invalid-state panel immediately ("Link inválido ou
//     expirado" + "Enviar novo link" → /esqueci-senha).
//   * Form: nova senha + confirmar senha with the live 6-72 validator — parity
//     with /cadastro (min 6 "Senha deve ter 6 caracteres"; max 72 to avoid
//     bcrypt truncation — NO invented uppercase/lowercase/number rules);
//     matching-confirmation check; "Redefinir senha" button.
//   * Submit → POST /api/auth/reset-password { token, new_password } with
//     credentials: "include".
//       - 200 { message: "Senha redefinida com sucesso!" } → inline success
//         state for ~1.5s → /login (the user logs in with the new password;
//         reset mints NO session — parity, routes.py:172-192).
//       - 400 with "Token inválido" / "Token inválido ou expirado" → swap to
//         the invalid-state panel ("Enviar novo link" → /esqueci-senha) and
//         surface the exact server message (routes.py:179; T-26-11-02/03).
//       - 429 → D-12 retryable rate message inline.
//       - other 4xx/5xx → inline the D-12 message.
//   * Errors/success render as text nodes — never dangerouslySetInnerHTML with
//     response-controlled strings (T-26-11-05).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RATE_MESSAGE = "Muitas tentativas. Tente novamente em instantes.";
const SUCCESS_MESSAGE = "Senha redefinida com sucesso!";
const SUCCESS_DISPLAY_MS = 1500;

/** 400-message branch that indicates a dead/consumed/replayed token. */
function isTokenError(msg: string | undefined) {
  return msg === "Token inválido" || msg === "Token inválido ou expirado";
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // D-09 link format — the token ONLY via URL param (never form/state).
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Invalid-token panel state (token absent at load, or the server rejects it).
  const [invalidToken, setInvalidToken] = useState(!token);
  // Exact server message surfaced on the invalid panel (400 branch).
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Next 15 cannot export `metadata` from a "use client" page (build error),
  // and the (auth) layout serves both pages — set the per-page title directly.
  useEffect(() => {
    document.title = "Redefinir Senha | Doce Ilusão";
  }, []);

  // 200 → show the success state briefly, then /login (reset mints no session
  // — the user logs in with the new password; parity).
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => router.push("/login"), SUCCESS_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [success, router]);

  function validate(): string | null {
    if (password.length < 6) return "Senha deve ter 6 caracteres";
    // Byte-based max check to match the server-side TextEncoder guard
    // (reset-password/route.ts:72) and the bcrypt 72-byte limit — mirrors the
    // /cadastro validator (cadastro/page.tsx:58).
    if (new TextEncoder().encode(password).length > 72) return "Senha deve ter no máximo 72 caracteres";
    if (confirm !== password) return "As senhas não coincidem";
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading || !token) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, new_password: password }),
      });

      if (res.ok) {
        setSuccess(true);
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.status === 429) {
        setError(RATE_MESSAGE);
        return;
      }

      const serverMessage = body?.error;

      if (res.status === 400 && isTokenError(serverMessage)) {
        // Dead/expired/consumed/replayed token → invalid-state panel with the
        // EXACT parity message (routes.py:179; T-26-11-03).
        setInvalidToken(true);
        setTokenError(serverMessage);
        return;
      }

      // Other 4xx (format/size/404) or 5xx — inline the D-12 message.
      setError(serverMessage ?? "Não foi possível redefinir a senha. Tente novamente.");
    } catch {
      setError("Não foi possível redefinir a senha. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  // Invalid-state panel — shared by the no-token case and the 400 token branch.
  if (invalidToken) {
    return (
      <>
        <h2 className="mb-6 text-center text-xl font-semibold">Link inválido</h2>

        <p
          role="alert"
          className="mb-8 rounded-lg bg-destructive/5 px-4 py-3 text-center text-sm font-medium text-destructive"
        >
          {tokenError ?? "Link inválido ou expirado"}
        </p>

        <p className="mb-8 text-center text-sm text-muted-foreground">
          O link de recuperação é inválido ou já foi utilizado. Solicite um
          novo link para redefinir sua senha.
        </p>

        <Button size="lg" className="w-full" asChild>
          <Link href="/esqueci-senha">Enviar novo link</Link>
        </Button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Voltar para o login
          </Link>
        </p>
      </>
    );
  }

  if (success) {
    return (
      <>
        <h2 className="mb-6 text-center text-xl font-semibold">
          Senha atualizada
        </h2>

        <p
          role="status"
          className="mb-8 rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700"
        >
          {SUCCESS_MESSAGE}
        </p>

        <p className="text-center text-sm text-muted-foreground">
          Redirecionando para o login…
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="mb-6 text-center text-xl font-semibold">
        Redefinir senha
      </h2>

      <p className="mb-6 text-center text-sm text-muted-foreground">
        Defina uma nova senha para a sua conta.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            background="light"
            placeholder="••••••••"
            aria-label="Nova senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">
            mínimo 6 caracteres
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="confirm">Confirmar nova senha</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            background="light"
            placeholder="••••••••"
            aria-label="Confirmar nova senha"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={isLoading}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? "Redefinindo..." : "Redefinir senha"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Voltar para o login
          </Link>
        </p>
      </form>
    </>
  );
}

// Suspense boundary: useSearchParams must be under one during static
// prerendering in Next 15 (build-time requirement, dev unaffected).
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}