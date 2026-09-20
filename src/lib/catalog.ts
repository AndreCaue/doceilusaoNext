// Catalog read module — single source of catalog reads against Prisma (D-01, D-02, D-03)
// All public + admin catalog reads go through this module. Read-only — no writes.
// Threat mitigations: T-27-01-01 (URL param casting + clamping)

import { prisma } from "./prisma";
import type {
  CatalogCategory,
  CatalogProduct,
  CatalogListResult,
} from "./types/catalog";

// ─── Helpers ───────────────────────────────────────────────────

/** Map a Prisma product (with included category) to CatalogProduct. */
function toCatalogProduct(
  p: Record<string, unknown> & {
    id: number;
    name: string;
    description: string | null;
    price: number;
    stock: number;
    reserved_stock: number | null;
    discount: number | null;
    image_urls: unknown;
    category_id: number;
    sku: string | null;
    shipping_preset_id: number | null;
    weight_grams: number | null;
    height_cm: number | null;
    width_cm: number | null;
    length_cm: number | null;
    category: {
      id: number;
      name: string;
      description: string | null;
      website: string | null;
      logo_url: string | null;
      sort_order: number | null;
    };
  },
): CatalogProduct {
  const reserved = p.reserved_stock ?? 0;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    stock: p.stock,
    reserved_stock: reserved,
    discount: p.discount,
    image_urls: Array.isArray(p.image_urls) ? (p.image_urls as string[]) : [],
    category: {
      id: p.category.id,
      name: p.category.name,
      description: p.category.description,
      website: p.category.website,
      logo_url: p.category.logo_url,
      sort_order: p.category.sort_order,
    },
    category_id: p.category_id,
    sku: p.sku,
    shipping_preset_id: p.shipping_preset_id,
    weight_grams: p.weight_grams,
    height_cm: p.height_cm,
    width_cm: p.width_cm,
    length_cm: p.length_cm,
    remainingStock: p.stock - reserved,
  };
}

/** Map a Prisma category to CatalogCategory. */
function toCatalogCategory(
  c: {
    id: number;
    name: string;
    description: string | null;
    website: string | null;
    logo_url: string | null;
    sort_order: number | null;
  },
  productCount: number,
): CatalogCategory {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    website: c.website,
    logo_url: c.logo_url,
    sort_order: c.sort_order,
    productCount,
  };
}

// ─── Category ordering rule ────────────────────────────────────
// NULL/0 sort_order → lowest priority (sort last among ordered items),
// then name ascending. See Plan 27-04/27-07 for the shared rule.
function categorySortComparator(a: CatalogCategory, b: CatalogCategory): number {
  // Null/zero sorts to the end: treat null/0 as high numbers
  const aRank = a.sort_order == null || a.sort_order === 0 ? Infinity : a.sort_order;
  const bRank = b.sort_order == null || b.sort_order === 0 ? Infinity : b.sort_order;
  if (aRank !== bRank) return aRank - bRank;
  return a.name.localeCompare(b.name, "pt-BR");
}

// ─── Public catalog queries ────────────────────────────────────

/**
 * List products with optional category-name filter and offset pagination.
 * - Filters by category name when provided (D-04: name, not slug).
 * - Orders newest-first by id desc (D-06).
 * - Page size defaults to 9 (D-05).
 * - Includes category relation with all needed fields.
 * - Computes remainingStock server-side (D-10).
 * - Clamps pageSize to max 50 (T-27-01-01: resource exhaustion guard).
 */
export async function listCatalogProducts({
  categoryName,
  page = 1,
  pageSize = 9,
}: {
  categoryName?: string | null;
  page?: number;
  pageSize?: number;
} = {}): Promise<CatalogListResult> {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const safePageSize = Math.min(50, Math.max(1, Math.floor(Number(pageSize) || 9)));
  const skip = (safePage - 1) * safePageSize;

  const where = categoryName
    ? { category: { name: categoryName } }
    : {};

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            description: true,
            website: true,
            logo_url: true,
            sort_order: true,
          },
        },
      },
      orderBy: { id: "desc" },
      skip,
      take: safePageSize,
    }),
    prisma.product.count({ where }),
  ]);

  const items = products.map(toCatalogProduct);

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages: Math.ceil(total / safePageSize),
  };
}

/**
 * Get a single product by ID for the detail page.
 * Returns null if not found.
 */
export async function getCatalogProductById(
  id: number,
): Promise<CatalogProduct | null> {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: {
        select: {
          id: true,
          name: true,
          description: true,
          website: true,
          logo_url: true,
          sort_order: true,
        },
      },
    },
  });

  if (!product) return null;
  return toCatalogProduct(product);
}

/**
 * List all categories with product counts (D-03).
 * Server-side group-by for counts, ordered by sort_order then name.
 */
export async function listCategoriesWithCounts(): Promise<CatalogCategory[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        logo_url: true,
        sort_order: true,
      },
    }),
    prisma.product.groupBy({
      by: ["category_id"],
      _count: { _all: true },
    }),
  ]);

  // Build a map of category_id → product count
  const countMap = new Map<number, number>();
  for (const entry of counts) {
    countMap.set(entry.category_id, entry._count._all);
  }

  // Merge counts and sort by sort_order then name
  const result = categories.map((c) =>
    toCatalogCategory(c, countMap.get(c.id) ?? 0),
  );
  result.sort(categorySortComparator);

  return result;
}

// ─── Admin catalog queries ─────────────────────────────────────

/**
 * List all products for admin views (D-02).
 * Newest-first, includes category relation. No pagination this phase.
 */
export async function listAdminProducts(): Promise<CatalogProduct[]> {
  const products = await prisma.product.findMany({
    include: {
      category: {
        select: {
          id: true,
          name: true,
          description: true,
          website: true,
          logo_url: true,
          sort_order: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  return products.map(toCatalogProduct);
}

/**
 * List all categories for admin views (D-02).
 * Ordered by sort_order then name, includes product counts via group-by.
 * Used by admin category list + reorder (Plan 27-07).
 */
export async function listAdminCategories(): Promise<CatalogCategory[]> {
  const [categories, counts] = await Promise.all([
    prisma.category.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        website: true,
        logo_url: true,
        sort_order: true,
      },
    }),
    prisma.product.groupBy({
      by: ["category_id"],
      _count: { _all: true },
    }),
  ]);

  const countMap = new Map<number, number>();
  for (const entry of counts) {
    countMap.set(entry.category_id, entry._count._all);
  }

  const result = categories.map((c) =>
    toCatalogCategory(c, countMap.get(c.id) ?? 0),
  );
  result.sort(categorySortComparator);

  return result;
}
