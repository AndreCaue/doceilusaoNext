// Admin product list page (STORE-05) — async Server Component under the (admin)
// master-gated layout. Reads all products via Prisma (D-02) and renders the
// ProductList table with Edit/Delete actions. "Cadastrar item" links to the create
// form. Empty state per UI-SPEC copywriting.

import { listAdminProducts } from "@/lib/catalog";
import { ProductList } from "@/components/admin/ProductList";
import { Button } from "@/components/ui/button";
import React from "react";

// Admin product list is a live view (master-gated, Prisma read) — never static.
// Force request-time rendering so deletes/edits reflect immediately (D-02).
export const dynamic = "force-dynamic";

export default async function AdminLojaPage() {
  const products = await listAdminProducts();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Produtos</h1>
        <Button asChild size="sm">
          <a href="/admin/loja/produtos/novo">Cadastrar item</a>
        </Button>
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground">Nenhum produto encontrado</p>
      ) : (
        <ProductList products={products} />
      )}
    </div>
  );
}
