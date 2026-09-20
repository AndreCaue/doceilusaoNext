// Admin category edit page (STORE-06) — async Server Component under the (admin)
// master-gated layout. Pre-fills the CategoryForm via Prisma read by id (D-02).
// Shows notFound() if the category doesn't exist. All writes proxy to Python (D-11).

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { CategoryForm } from "@/components/admin/CategoryForm";
import type { CatalogCategory } from "@/lib/types/catalog";

export const dynamic = "force-dynamic";

type TParams = { id: string };

async function getCategoryById(id: number): Promise<CatalogCategory | null> {
  const category = await prisma.category.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      website: true,
      logo_url: true,
      sort_order: true,
      _count: { select: { products: true } },
    },
  });

  if (!category) return null;

  return {
    id: category.id,
    name: category.name,
    description: category.description,
    website: category.website,
    logo_url: category.logo_url,
    sort_order: category.sort_order,
    productCount: category._count.products,
  };
}

export default async function AdminCategoriaEditarPage({
  params,
}: {
  params: Promise<TParams>;
}) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);

  if (!Number.isInteger(id) || id <= 0) {
    notFound();
  }

  const category = await getCategoryById(id);
  if (!category) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Editar Categoria</h1>
      <div className="max-w-xl">
        <CategoryForm mode="edit" seed={category} />
      </div>
    </div>
  );
}
