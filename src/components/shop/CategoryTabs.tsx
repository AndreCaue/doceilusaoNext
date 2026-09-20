// Server-friendly category tab bar for the public store listing.
// Presentational component — no data fetching. Renders linked tabs (<a>) so
// navigation stays URL-driven (D-04: ?category={name}), strangler-fig compatible.
import { cn } from "@/lib/utils";
import { categoryStyles } from "./helper";
import type { CatalogCategory } from "@/lib/types/catalog";

type TCategoryTabs = {
  categories: CatalogCategory[];
  /** Currently active category name (URL-decoded) or null when "Todos". */
  activeCategory: string | null;
};

export const CategoryTabs = ({
  categories,
  activeCategory,
}: TCategoryTabs) => {
  const isActive = (name: string) => activeCategory === name;

  return (
    <div className="flex justify-center gap-4 mb-16 flex-wrap md:px-20">
      {/* "Todos" tab — default, no ?category param */}
      <a
        href="/loja"
        className={cn(
          "relative px-8 py-5 rounded-2xl font-bold text-lg transition-all",
          activeCategory === null
            ? "text-white shadow-2xl bg-gradient-to-r from-purple-600 to-fuchsia-700"
            : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 backdrop-blur-sm",
        )}
      >
        <span className="relative flex items-center gap-2">Todos</span>
      </a>

      {categories.map((cat) => {
        const style = categoryStyles[cat.name] || {
          color: "from-gray-600 to-gray-800",
        };
        const active = isActive(cat.name);
        return (
          <a
            key={cat.id}
            href={`?category=${encodeURIComponent(cat.name)}`}
            className={cn(
              "relative px-8 py-5 rounded-2xl font-bold text-lg transition-all",
              active
                ? cn("text-white shadow-2xl bg-gradient-to-r", style.color)
                : "bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 backdrop-blur-sm",
            )}
          >
            <span className="relative flex items-center gap-2">
              {cat.name}
              {typeof cat.productCount === "number" && (
                <span className="text-sm opacity-80">({cat.productCount})</span>
              )}
            </span>
          </a>
        );
      })}
    </div>
  );
};
