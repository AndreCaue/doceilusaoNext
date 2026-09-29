import React from "react";
import Link from "next/link";

type StoreCategoryChipsProps = {
  categories: string[];
};

export function StoreCategoryChips({ categories }: StoreCategoryChipsProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-gray-300">
      <span className="text-gray-400">Categorias:</span>
      {categories.map((cat) => (
        <Link
          key={cat}
          href={`/loja?category=${encodeURIComponent(cat)}`}
          className="rounded-full border border-white/15 bg-gray-800/50 px-4 py-1.5 font-medium backdrop-blur-sm transition-colors hover:border-amber-300/50 hover:text-amber-200"
        >
          {cat}
        </Link>
      ))}
    </div>
  );
}
