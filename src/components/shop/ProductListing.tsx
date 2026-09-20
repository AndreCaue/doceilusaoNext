// Server Component — public store product listing grid.
// Fetches products via the catalog module's Prisma reads (D-01) and renders the
// ported ProductItem grid, plus exact UI-SPEC empty/error states.
// Resilient — never crashes on a Prisma error (renders the error copy instead).
import { listCatalogProducts } from "@/lib/catalog";
import { ProductItem } from "./ProductItem";

type TProductListing = {
  /** URL-decoded category name (from ?category=) or null for "Todos". (D-04) */
  category: string | null;
  /** Current page (1-based, from ?page=). (D-05) */
  page: number;
};

export const ProductListing = async ({
  category,
  page,
}: TProductListing) => {
  let items;
  try {
    const result = await listCatalogProducts({
      categoryName: category,
      page,
      pageSize: 9,
    });
    items = result.items;
  } catch {
    // Prisma/db error — render the UI-SPEC error copy, keep the page up.
    return (
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-light tracking-widest text-white/90">
            Erro ao carregar produtos. Tente novamente mais tarde.
          </h2>
        </div>
      </section>
    );
  }

  // Empty state (UI-SPEC copy) — no products in the current category/all.
  if (items.length === 0) {
    return (
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-light tracking-widest text-white/90 mb-6">
            Nenhum produto encontrado
          </h2>
          <p className="text-gray-300 text-xl">
            Não há produtos disponíveis nesta categoria no momento.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-24 md:py-32">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-12 md:gap-20 max-w-6xl mx-auto px-6">
        {items.map((product) => (
          <ProductItem
            key={product.id}
            id={product.id}
            discount={product.discount ?? 0}
            image_urls={product.image_urls}
            name={product.name}
            reserved_stock={product.reserved_stock}
            stock={product.stock}
            price={product.price}
          />
        ))}
      </div>
    </section>
  );
};
