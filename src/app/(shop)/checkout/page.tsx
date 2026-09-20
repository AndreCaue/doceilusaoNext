// Checkout page — Server Component shell (CHECKOUT-01).
// Requires auth: resolves the access cookie via next/headers, runs it through
// getCurrentUserOptional (guards contract), and redirects guests to
// /login?redirect=/checkout so they return here after login.
//
// Note: Server Components have no NextRequest — we build a minimal request shim
// from the cookie store (the same next/headers pattern admin-proxy.ts uses) so
// the guards module stays the single identity source.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import React from "react";

import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import { CheckoutForm } from "@/components/shop/CheckoutForm";
import { getCurrentUserOptional } from "@/lib/auth/guards";

export default async function CheckoutPage() {
  const store = await cookies();

  // Minimal request shim — getTokenFromRequest only reads the Authorization
  // header (absent in Server Components) and the access_token cookie.
  const req = {
    headers: new Headers(),
    cookies: {
      get: (name: string) => {
        const v = store.get(name);
        return v ? { name, value: v.value } : undefined;
      },
    },
  } as unknown as NextRequest;

  const user = await getCurrentUserOptional(req);
  if (!user) {
    redirect("/login?redirect=/checkout");
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 py-30 max-w-6xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Checkout"
          subTitle="Preencha seus dados de entrega e finalize a compra"
        />

        <CheckoutForm />
      </div>
    </div>
  );
}
