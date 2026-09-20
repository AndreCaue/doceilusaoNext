// Product detail page — Server Component (STORE-02).
// Fetches a single product by id via Prisma (D-01), 404s on missing/invalid id
// (T-27-05-01), and feeds the ProductDetail client component serialized data.
// Left column = image gallery (Images.tsx adapted to next/image, D-07).
import { notFound } from "next/navigation";
import React from "react";
import { getCatalogProductById } from "@/lib/catalog";
import { Images } from "@/components/shop/Images";
import { ProductDetail } from "@/components/shop/ProductDetail";
import type { CatalogProduct } from "@/lib/types/catalog";

type TParams = {
  id: string;
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<TParams>;
}) {
  const { id } = await params;

  // T-27-05-01: id is client input from the URL. Parse + validate a positive
  // integer; anything else (NaN, <= 0, or non-canonical like "12abc") → 404.
  const trimmed = id?.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    notFound();
  }

  const product = await getCatalogProductById(parsed);
  if (!product) {
    notFound();
  }

  // JSON-serializable shape for the Client Component. CatalogProduct is already
  // plain values (id, name, price, stock, reserved_stock, remainingStock,
  // image_urls, description, discount) — no non-serializable fields.
  const serialized: CatalogProduct = product;

  return (
    <div className="max-w-7xl mx-auto px-4 py-30">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <Images product={serialized} />
        <ProductDetail product={serialized} />
      </div>
    </div>
  );
}
