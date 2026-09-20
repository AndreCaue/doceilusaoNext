"use client";

// /esqueci-senha — client form over POST /api/auth/forgot-password (26-06),
// AUTH-06 (enumeration-proof UX).
//
// Contract honored:
//   * Single field: e-mail → POST /api/auth/forgot-password { email } with
//     credentials: "include" (D-01 cookie transport).
//   * ANTI-ENUMERATION REQUIRED: on ANY 2xx the form is REPLACED by a static
//     confirmation panel. The LOUD line "Enviamos uma mensagem para o seu
//     e-mail." is rendered UNCONDITIONALLY for every 2xx submission — the
//     branch never inspects the body or status beyond res.ok, so it is
//     identical for existing AND non-existing accounts (leaks nothing,
//     T-26-11-01). The byte-identical anti-enumeration message "Se o e-mail
//     estiver cadastrado, enviaremos um link de recuperação." (routes.py:
//     153/169 exact) remains the panel's SECONDARY text — NEVER "e-mail não
//     encontrado", NEVER a different message, NEVER conditional UI branching
//     on the 200 body.
//   * 429 → D-12 retryable rate message inline ("Muitas tentativas. Tente
//     novamente em instantes.") — rate states are shared by both branches, so
//     they reveal nothing (rate limits apply regardless of account existence).
//   * 400 "E-mail inválido" → inline byte-exact (routes.py:146 — a format
//     error raised BEFORE the existence probe; no enumeration signal).
//   * 5xx / network errors → generic inline text (never existence-flavored).
//   * Link back: "Voltar para o login" → /login.
//   * Errors/success render as text nodes — never dangerouslySetInnerHTML with
//     response-controlled strings (T-26-11-05).

import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Byte-identical to the API's anti-enumeration confirmation (routes.py:153/169
// — GENERIC_MESSAGE in the 26-06 route; forgot-password/route.ts:62-63). Never
// vary this string; the page renders it as the panel's SECONDARY text for
// EVERY successful submission.
const CONFIRMATION_MESSAGE =
  "Se o e-mail estiver cadastrado, enviaremos um link de recuperação.";

// Underscored EmailStr format check — same shape as the forgot-password
// route's inline zod schema (EmailStr parity).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RATE_MESSAGE = "Muitas tentativas. Tente novamente em instantes.";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Replaces the entire form with the static confirmation panel (anti-
  // enumeration: identical for every 2xx outcome).
  const [submitted, setSubmitted] = useState(false);

  // Next 15 cannot export `metadata` from a "use client" page (build error),
  // and the (auth) layout serves both pages — set the per-page title directly.
  useEffect(() => {
    document.title = "Recuperar Senha | Doce Ilusão";
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isLoading) return;

    // Client-side format check ONLY (never existence): mirrors the API's 400
    // "E-mail inválido" raised before any existence probe — the same message
    // for every malformed input (format, not enumeration).
    if (!EMAIL_RE.test(email)) {
      setError("E-mail inválido");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        // ANY 2xx → the same static panel. The API returns 200 with an
        // identical body for both branches (routes.py:153/169) — the UI must
        // mirror that: one confirmation, no branching on the body.
        setSubmitted(true);
        return;
      }

      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (res.status === 429) {
        // Rate limit — shared by both branches (routes.py:142), reveals
        // nothing about account existence.
        setError(RATE_MESSAGE);
      } else if (res.status === 400) {
        // Format error raised before the existence probe — byte-exact
        // (routes.py:146). Existence is never referenced.
        setError(body?.error ?? "E-mail inválido");
      } else {
        // 5xx / unexpected — generic, no existence flavor.
        setError("Não foi possível concluir a solicitação. Tente novamente.");
      }
    } catch {
      setError("Não foi possível concluir a solicitação. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  }

  // Anti-enumeration panel — identical for EVERY 2xx (existing AND
  // non-existing accounts): the loud send aviso is unconditional, and the
  // byte-identical CONFIRMATION_MESSAGE stays the secondary text.
  if (submitted) {
    return (
      <>
        <h2 className="mb-6 text-center text-xl font-semibold">
          Solicitação recebida
        </h2>

        <div
          role="status"
          className="mb-8 rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700"
        >
          <p>Enviamos uma mensagem para o seu e-mail.</p>
          <p className="mt-1 text-xs text-emerald-600">
            {CONFIRMATION_MESSAGE}
          </p>
        </div>

        <p className="mb-8 text-center text-sm text-muted-foreground">
          Confira sua caixa de entrada: se o e-mail estiver cadastrado, o link
          de recuperação chegará em poucos minutos. Não encontrou? Verifique
          também a pasta de spam.
        </p>

        <p className="text-center text-sm text-muted-foreground">
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

  return (
    <>
      <h2 className="mb-6 text-center text-xl font-semibold">
        Recuperar senha
      </h2>

      <p className="mb-6 text-center text-sm text-muted-foreground">
        Informe o e-mail da sua conta e enviaremos um link de recuperação.
      </p>

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

        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
          {isLoading ? "Enviando..." : "Enviar link de recuperação"}
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
