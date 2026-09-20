// Admin category list page (STORE-06) — async Server Component under the (admin)
// master-gated layout. Reads all categories via Prisma (D-02) with product counts
// and renders the CategoryList table with up/down reorder + edit/delete actions.
// "Cadastrar Categoria" links to the create form.

import { listAdminCategories } from "@/lib/catalog";
import { CategoryList } from "@/components/admin/CategoryList";
import { Button } from "@/components/ui/button";
import React from "react";

// Admin category list is a live view (master-gated, Prisma read) — never static.
// Force request-time rendering so reorders/edits/deletes reflect immediately (D-02).
export const dynamic = "force-dynamic";

export default async function AdminCategoriasPage() {
  const categories = await listAdminCategories();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Categorias</h1>
        <Button asChild size="sm">
          <a href="/admin/loja/categorias/novo">Cadastrar Categoria</a>
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma categoria encontrada</p>
      ) : (
        <CategoryList categories={categories} />
      )}
    </div>
  );
}
