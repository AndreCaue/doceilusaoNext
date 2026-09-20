// / — public home page (Server Component, no client interactivity).
//
// Visual target: SPA Frontend/src/Pages/Home/Home.tsx — hero carousel of
// category cards using the suit motifs (♦ Vídeos / ♠ Baralhos / ♥ Trukes /
// ♣ Livros) — ported onto the dark gradient brand look of /loja
// (bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800, rounded cards,
// amber accents). Lives in the (shop) route group so it inherits the Topbar.
//
// Scope notes (26-10 checkpoint fixes, round 2 — user request):
//   * Separate content routes (/conteudo/videos, /trukes, /livros) do NOT
//     exist in Next yet — every suit card links to /loja (the store).
//   * The store's REAL categories (Tarot, Velas, Cristais) are surfaced as
//     chips below the carousel with working ?category= deep links.
//   * Pure Server Component: no toast/VerifyDialog logic (SPA parity NOT
//     ported), no carousel JS — scroll-snap overflow row instead of embla.
//   * The SPA CardContainer's stray "A" glyph before the mini icon is a
//     typo in the SPA — deliberately not ported.

import React from "react";

import type { Metadata } from "next";
import Link from "next/link";
import { Club, Diamond, Heart, Spade, type LucideIcon } from "lucide-react";

import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayFooter } from "@/components/shop/DisplayFooter";
import { DisplayHeader } from "@/components/shop/DisplayHeader";

export const metadata: Metadata = {
  title: "Início | Doce Ilusão",
};

type TSuitCard = {
  name: string;
  Icon: LucideIcon;
  /** Red suits (♦ ♥) render #FF0000; black suits (♠ ♣) render white on the dark card. */
  red: boolean;
};

const SUIT_CARDS: TSuitCard[] = [
  { name: "Vídeos", Icon: Diamond, red: true },
  { name: "Baralhos", Icon: Spade, red: false },
  { name: "Trukes", Icon: Heart, red: true },
  { name: "Livros", Icon: Club, red: false },
];

const STORE_CATEGORIES = ["Tarot", "Velas", "Cristais"];

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800">
      <DisplayBackground />

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-24 md:px-6 md:pt-28">
        <DisplayHeader
          title="Doce Ilusão"
          subTitle="Entre no universo da mágica: vídeos, baralhos, trukes e livros de ilusão para todos os níveis"
        />

        {/* Hero carousel — suit category cards (SPA Home parity). Pure CSS
            scroll-snap (no client JS): swipe/scroll horizontally. */}
        <div className="flex snap-x snap-mandatory gap-6 overflow-x-auto pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SUIT_CARDS.map(({ name, Icon, red }) => (
            <Link
              key={name}
              href="/loja"
              aria-label={`Ir para a loja — ${name}`}
              className="group flex aspect-square w-[280px] shrink-0 snap-center flex-col items-center justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-gray-800/80 via-gray-700/60 to-gray-800/80 p-6 shadow-2xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-amber-300/50 hover:shadow-lg hover:shadow-amber-500/10 md:w-[320px]"
            >
              <span className="flex w-full items-center gap-3 text-2xl font-semibold text-white">
                <Icon
                  size={28}
                  strokeWidth={1.5}
                  className={
                    red
                      ? "fill-[#FF0000] text-[#FF0000]"
                      : "fill-white text-white"
                  }
                />
                {name}
              </span>

              <Icon
                size={150}
                strokeWidth={1}
                className={
                  red
                    ? "fill-[#FF0000] text-[#FF0000] transition-transform duration-300 group-hover:scale-110"
                    : "fill-white text-white transition-transform duration-300 group-hover:scale-110"
                }
              />

              <span className="flex w-full rotate-180 items-center justify-end gap-3 text-2xl font-semibold text-white">
                <Icon
                  size={28}
                  strokeWidth={1.5}
                  className={
                    red
                      ? "fill-[#FF0000] text-[#FF0000]"
                      : "fill-white text-white"
                  }
                />
                {name}
              </span>
            </Link>
          ))}
        </div>

        {/* CTA + real store categories with working ?category= deep links. */}
        <div className="mt-12 flex flex-col items-center gap-6">
          <Link
            href="/loja"
            className="rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-10 py-4 text-lg font-bold text-gray-900 shadow-xl shadow-amber-500/20 transition-all hover:brightness-110 active:scale-95"
          >
            Explorar a loja
          </Link>

          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-300">
            <span className="text-gray-400">Categorias:</span>
            {STORE_CATEGORIES.map((cat) => (
              <Link
                key={cat}
                href={`/loja?category=${encodeURIComponent(cat)}`}
                className="rounded-full border border-white/15 bg-gray-800/50 px-4 py-1.5 font-medium backdrop-blur-sm transition-colors hover:border-amber-300/50 hover:text-amber-200"
              >
                {cat}
              </Link>
            ))}
          </div>
        </div>

        <DisplayFooter />
      </div>
    </div>
  );
}
