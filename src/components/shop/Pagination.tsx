// Prev/next + page-number pagination for the public store listing.
// Presentational component — uses <a> tags so page state stays URL-driven (D-05: ?page={n}).
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type TPagination = {
  /** Current page (1-based). */
  page: number;
  totalPages: number;
  /** Current query string (e.g. `?category=Baralhos`) WITHOUT the page param. */
  baseQuery: string;
};

/**
 * Build the pagination href. When baseQuery is present, preserve the category
 * (e.g. `?category=...&page=2`); otherwise just `?page={n}`.
 */
function hrefForPage(baseQuery: string, page: number): string {
  if (!baseQuery) return `/loja?page=${page}`;
  const separator = baseQuery.includes("?") ? "&" : "?";
  return `${baseQuery}${separator}page=${page}`;
}

export const Pagination = ({ page, totalPages, baseQuery }: TPagination) => {
  if (totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  const pageNumbers: number[] = [];
  for (let n = 1; n <= totalPages; n++) pageNumbers.push(n);

  // Start from "/loja" or the given base query (strip trailing angle for safety)
  const base = baseQuery || "";

  return (
    <nav
      aria-label="Paginação"
      className="flex items-center justify-center gap-2 flex-wrap mt-12"
    >
      {/* Prev */}
      {prevDisabled ? (
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800/40 text-gray-600 cursor-not-allowed">
          <ChevronLeft className="w-5 h-5" />
        </span>
      ) : (
        <a
          href={hrefForPage(base, page - 1)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </a>
      )}

      {/* Page numbers */}
      {pageNumbers.map((n) => (
        <a
          key={n}
          href={hrefForPage(base, n)}
          aria-current={n === page ? "page" : undefined}
          className={cn(
            "inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-semibold transition-colors",
            n === page
              ? "bg-gradient-to-br from-purple-600 to-fuchsia-700 text-white shadow-lg"
              : "bg-gray-800/50 text-gray-300 hover:bg-gray-700/50",
          )}
        >
          {n}
        </a>
      ))}

      {/* Next */}
      {nextDisabled ? (
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800/40 text-gray-600 cursor-not-allowed">
          <ChevronRight className="w-5 h-5" />
        </span>
      ) : (
        <a
          href={hrefForPage(base, page + 1)}
          className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gray-800/50 text-gray-300 hover:bg-gray-700/50 transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </a>
      )}
    </nav>
  );
};
