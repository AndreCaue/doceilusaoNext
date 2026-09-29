import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import React from "react";

type TSuitCard = {
  name: string;
  Icon: LucideIcon;
  /** Red suits (♦ ♥) render #FF0000; black suits (♠ ♣) render white on the dark card. */
  red: boolean;
  href: string;
};

export const SuitCard = ({ Icon, href, name, red }: TSuitCard) => {
  const iconColor = red ? "fill-[#FF0000] text-black" : "fill-white text-black";
  return (
    <div className="  snap-x snap-mandatory  gap-6 overflow-x-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Link
        key={name}
        href={href}
        aria-label={`Ir para a loja — ${name}`}
        className="group flex aspect-square w-[200px] shrink-0 snap-center flex-col items-center justify-between rounded-2xl border border-white/10 bg-gradient-to-br from-gray-800/80 via-gray-700/60 to-gray-800/80 p-6 shadow-2xl backdrop-blur-sm transition-all duration-300 hover:-translate-y-2 hover:border-amber-300/50 hover:shadow-lg hover:shadow-amber-500/10 md:w-[250px]"
      >
        <span className="flex w-full items-center gap-3 text-2xl font-semibold text-white">
          <Icon size={28} strokeWidth={1.5} className={iconColor} />
          {name}
        </span>

        <Icon
          size={150}
          strokeWidth={1}
          className={`${iconColor} transition-transform duration-300 group-hover:scale-110`}
        />

        <span className="flex w-full rotate-180 items-center justify-start gap-3 text-2xl font-semibold text-white">
          <Icon size={28} strokeWidth={1.5} className={iconColor} />
          {name}
        </span>
      </Link>
    </div>
  );
};
