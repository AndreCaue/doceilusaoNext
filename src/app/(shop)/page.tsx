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
import { SuitCard } from "@/components/shop/SuitCard";
import { StoreCategoryChips } from "@/components/shop/StoreCategoryChips";

export const metadata: Metadata = {
  title: "Início | Doce Ilusão",
};

type TSuitCard = {
  name: string;
  Icon: LucideIcon;
  /** Red suits (♦ ♥) render #FF0000; black suits (♠ ♣) render white on the dark card. */
  red: boolean;
  href: string;
};

const SUIT_CARDS: TSuitCard[] = [
  { name: "Vídeos", Icon: Diamond, red: true, href: "/videos" }, // verificar url
  { name: "Baralhos", Icon: Spade, red: false, href: "loja?category=Baralhos" },
  { name: "Trukes", Icon: Heart, red: true, href: "/trukes" },
  { name: "Livros", Icon: Club, red: false, href: "loja?category=Livros" },
];

const STORE_CATEGORIES = ["Baralho", "Acessórios", "Vídeos"]; // Devera vir do backend.

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800">
      <DisplayBackground />

      <div className="relative z-10 mx-auto max-w-6xl px-4 pb-16 pt-28 md:px-6 ">
        <DisplayHeader
          title="Doce Ilusão"
          subTitle="Entre no universo da mágica: vídeos, baralhos, trukes e livros de ilusão para todos os níveis"
        />

        {/* Hero carousel — suit category cards (SPA Home parity). Pure CSS
            scroll-snap (no client JS): swipe/scroll horizontally. */}

        <div className="grid grid-cols-2 md:flex">
          {SUIT_CARDS.map((card) => (
            <SuitCard
              key={card.name}
              Icon={card.Icon}
              name={card.name}
              red={card.red}
              href={card.href}
            />
          ))}
        </div>

        {/* CTA + real store categories with working ?category= deep links. */}
        <div className="mt-12 flex flex-col items-center gap-6">
          <Link
            href="/loja"
            className="rounded-xl bg-gradient-to-r from-gray-200 to-gray-700 px-10 py-4 text-lg font-bold text-gray-900 shadow-lg shadow-gray-900 transition-all hover:brightness-110 active:scale-95  brand-hover"
          >
            Explorar a loja
          </Link>

          <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-300">
            <StoreCategoryChips categories={STORE_CATEGORIES} />
          </div>
        </div>

        <DisplayFooter />
      </div>
    </div>
  );
}
