// Shared (auth) route-group layout — server component (no client directive:
// zero interactivity here; the pages below are the client halves).
//
// Route group contract (D-05): URLs stay /login, /cadastro, /verificar-email,
// /esqueci-senha, /redefinir-senha — the (auth) group adds no URL prefix.
//
// Shell per the auth UI contract (ui-brand.md): full-height soft-pastel
// backdrop, centered rounded-2xl white brand card, Doce Ilusão wordmark
// treatment (the SPA auth screens' gradient mark + name), PT-BR copy only.
// No metadata here — pages set their own title (client pages set
// document.title; nothing conflicts with the root layout's defaults).
import React from "react";

const BRAND_GRADIENT =
  "linear-gradient(45deg, #f9f6ec, #88a1a8, #502940, #790614, #0d0c0c)";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-rose-100 via-amber-50 to-slate-200 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-white/60 bg-white/95 px-8 py-10 shadow-xl backdrop-blur">
        <header className="mb-8 flex flex-col items-center gap-4">
          {/* Wordmark/logo treatment — compact nod to the SPA auth LogoTitle
              (rotated gradient square + letter), centered above the card body. */}
          <div
            aria-hidden
            className="flex h-14 w-14 rotate-45 items-center justify-center rounded-xl shadow-md"
            style={{ background: BRAND_GRADIENT }}
          >
            <span className="-rotate-45 select-none text-3xl font-bold text-white">
              D
            </span>
          </div>
          <h1 className="text-center text-2xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-[#502940] via-[#790614] to-[#0d0c0c] bg-clip-text text-transparent">
              Doce Ilusão
            </span>
          </h1>
        </header>

        <main>{children}</main>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          © {year} Doce Ilusão
        </footer>
      </div>
    </div>
  );
}
