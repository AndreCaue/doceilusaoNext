"use client";

// /cadastro — client form over POST /api/auth/register (26-04), AUTH-01 + D-07.
//
// Contract honored:
//   * UserCreate parity (routes.py:66-90): { email, password } ONLY — the
//     backend stores no name (the SPA's name input was ignored server-side;
//     do not port it). Password rule = 6..72 chars ONLY — no invented
//     uppercase/lowercase/number requirements.
//   * Pre-submit client validation mirrors the 400 messages the route emits
//     ("Senha deve ter 6 caracteres" byte-exact — routes.py:74).
//   * Submit → JSON { email, password } with credentials: "include" (D-01).
//   * 200 UserOut → success panel with "Enviamos um código de verificação"
//     aviso + "Fazer login" CTA (D-07 preserved: still NO auto-login — the
//     panel REPLACES the instant redirect as explicit send-feedback; the
//     visitor then logs in and verifies).
//   * 400 "Email já cadastrado" → inline byte-exact (routes.py:70, no accent
//     on "Email") + "Fazer login" link; other D-12 400s → error.message.
//   * Errors render as text nodes ({error}) — never dangerouslySetInnerHTML
//     with response-controlled strings (T-26-10-05).
import React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Underscored EmailStr format check — same shape as the register route's
// EMAIL_RE (schemas.py EmailStr parity).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // 200 register → success panel (send-feedback) instead of an instant
  // redirect — email stays in state for the panel display.
  const [created, setCreated] = useState(false);

  // Next 15 cannot export `metadata` from a "use client" page (build error),
  // and the (auth) layout serves both pages — set the per-page title directly.
  useEffect(() => {
    document.title = "Criar Conta | Doce Ilusão";
  }, []);

  /** Pre-submit validation — inline 400-shaped errors, block submit. */
  function validate(): string | null {
    if (!EMAIL_RE.test(email)) return "E-mail inválido";
    if (password.length < 6) return "Senha deve ter 6 caracteres";
    // Byte-based max check to match the server-side TextEncoder guard and
    // the bcrypt 72-byte limit (password.ts / reset-password/route.ts:81).
    if (new TextEncoder().encode(password).length > 72)
      return "Senha deve ter no máximo 72 caracteres";
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (res.ok) {
        // UserOut shape → success panel (D-07: register grants NO session —
        // no auto-login; the visitor then logs in and verifies). The panel is
        // explicit send-feedback that a verification code was emailed.
        setCreated(true);
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.status === 429) {
        setError("Muitas tentativas. Tente novamente em instantes.");
      } else {
        // 400s: "Email já cadastrado", "Senha deve ter 6 caracteres", etc.
        // (D-12 shape) — show the message inline; the duplicate case gets the
        // extra "Fazer login" link below.
        setError(
          body?.error ?? "Não foi possível criar a conta. Tente novamente.",
        );
      }
    } catch {
      setError("Não foi possível criar a conta. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  // Post-register success panel — explicit feedback that the verification
  // code was emailed (D-07 preserved: still no auto-login; the visitor goes
  // to /login from here, then verifies).
  if (created) {
    return (
      <>
        <h2 className="mb-6 text-center text-xl font-semibold">
          Conta criada com sucesso
        </h2>

        <div
          role="status"
          className="mb-8 rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700"
        >
          <p>Enviamos um código de verificação para o seu e-mail.</p>
          <p className="mt-1 font-semibold">{email.toLowerCase()}</p>
        </div>

        <p className="mb-8 text-center text-sm text-muted-foreground">
          Verifique sua caixa de entrada — incluindo a pasta de spam — e
          confirme sua conta. O código expira em 15 minutos.
        </p>

        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => router.push("/login")}
        >
          Fazer login
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Só falta confirmar o e-mail para liberar seu acesso completo à loja.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="mb-6 text-center text-xl font-semibold">Criar conta</h2>

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
            autoComplete="new-password"
            required
            background="light"
            placeholder="••••••••"
            aria-label="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          <p className="text-xs text-muted-foreground">mínimo 6 caracteres</p>
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        {error === "Email já cadastrado" && (
          <p className="-mt-2 text-sm text-muted-foreground">
            Já tem uma conta?{" "}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              Fazer login
            </Link>
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? "Criando conta..." : "Criar conta"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline"
          >
            Entrar
          </Link>
        </p>
      </form>
    </>
  );
}
