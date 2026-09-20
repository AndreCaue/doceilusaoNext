// Shared catalog types — single typed contract for all catalog pages/components
// Mirrors the existing SPA IProduct/ICategory shapes mapped from Prisma query results
// Phase 27 (D-01, D-02): Every catalog page consumes these types

export type CatalogCategory = {
  id: number;
  name: string;
  description: string | null;
  website: string | null;
  logo_url: string | null;
  sort_order: number | null;
  productCount?: number;
};

export type CatalogProduct = {
  id: number;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  reserved_stock: number;
  discount: number | null;
  image_urls: string[];
  category: CatalogCategory;
  category_id: number;
  sku: string | null;
  /** Shipping preset reference (Plan 27-06 edit-form prefill). */
  shipping_preset_id: number | null;
  weight_grams: number | null;
  height_cm: number | null;
  width_cm: number | null;
  length_cm: number | null;
  /** Server-computed: stock - reserved_stock (D-10) */
  remainingStock: number;
};

export type CatalogListResult = {
  items: CatalogProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
