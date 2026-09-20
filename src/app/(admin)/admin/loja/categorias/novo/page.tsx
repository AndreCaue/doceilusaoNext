// Admin category create page (STORE-06) — async Server Component under the (admin)
// master-gated layout. Renders the CategoryForm in "create" mode.
// All writes proxy to Python (D-11) via the API route handlers.

import { CategoryForm } from "@/components/admin/CategoryForm";

export const dynamic = "force-dynamic";

export default async function AdminCategoriaNovoPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Cadastrar Categoria</h1>
      <div className="max-w-xl">
        <CategoryForm mode="create" />
      </div>
    </div>
  );
}
