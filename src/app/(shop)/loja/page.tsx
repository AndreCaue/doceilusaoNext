// Public store listing page — Server Component (STORE-01, STORE-03).
// Single source of truth = the URL: category (?category=, D-04) and page (?page=, D-05)
// persist/share/refresh via searchParams. Reads are Prisma-direct via the catalog module (D-01).
import { listCatalogProducts, listCategoriesWithCounts } from "@/lib/catalog";
import { CategoryTabs } from "@/components/shop/CategoryTabs";
import { ProductListing } from "@/components/shop/ProductListing";
import { Pagination } from "@/components/shop/Pagination";
import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import { DisplayFooter } from "@/components/shop/DisplayFooter";
import React from "react";

type TSearchParams = {
  category?: string;
  page?: string;
};

export default async function LojaPage({
  searchParams,
}: {
  searchParams: Promise<TSearchParams>;
}) {
  const params = await searchParams;

  // Parse + guard user-controlled URL params (threat T-27-04-01 / T-27-04-02).
  // Next.js already decodes searchParams via URLSearchParams — do NOT decode again:
  // a category containing a literal "%" (e.g. "50% Mágica") would throw URIError here.
  const categoryParam =
    typeof params.category === "string" ? params.category.trim() : null;
  const activeCategory = categoryParam || null;

  // Guard page >= 1 (catalog module also re-guards/clamps, T-27-04-02).
  let page = 1;
  if (typeof params.page === "string") {
    const parsed = Number.parseInt(params.page, 10);
    if (!Number.isNaN(parsed)) page = Math.max(1, parsed);
  }

  // Fetch categories (tabs + counts, D-03) and products (items + totalPages) in parallel.
  // Guard the page-level reads: on a Prisma/db failure this used to reject the whole
  // route before ProductListing's own catch could render — render the same UI-SPEC
  // error copy here so the resilience path is real (WR-03).
  let categories;
  let result;
  try {
    [categories, result] = await Promise.all([
      listCategoriesWithCounts(),
      listCatalogProducts({ categoryName: activeCategory, page, pageSize: 9 }),
    ]);
  } catch {
    return (
      <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
        <DisplayBackground />
        <div className="relative z-10 pt-12 pb-16 max-w-6xl mx-auto px-4 md:px-6">
          <DisplayHeader
            title="Loja"
            subTitle="Explore a nossa coleção exclusiva de produtos de ilusão"
          />
          <section className="py-24 md:py-32">
            <div className="max-w-6xl mx-auto px-6 text-center">
              <h2 className="text-3xl md:text-4xl font-light tracking-widest text-white/90">
                Erro ao carregar produtos. Tente novamente mais tarde.
              </h2>
            </div>
          </section>
        </div>
      </div>
    );
  }

  // Pagination baseQuery carries the current category when present (URL share/refresh).
  const baseQuery = activeCategory
    ? `?category=${encodeURIComponent(activeCategory)}`
    : "";

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 pt-12 pb-16 max-w-6xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Loja"
          subTitle="Explore a nossa coleção exclusiva de produtos de ilusão"
        />

        <CategoryTabs categories={categories} activeCategory={activeCategory} />

        <ProductListing category={activeCategory} page={page} />

        <Pagination
          page={page}
          totalPages={result.totalPages}
          baseQuery={baseQuery}
        />

        <DisplayFooter />
      </div>
    </div>
  );
}
