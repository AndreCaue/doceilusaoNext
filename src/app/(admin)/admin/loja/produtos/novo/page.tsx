// Admin product create page (STORE-05) — renders the ProductForm in create mode
// under the (admin) master-gated layout. All writes proxy to Python (D-11).
import { ProductForm } from "@/components/admin/ProductForm";

export default function NewProductPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Cadastrar item</h1>
      <ProductForm mode="create" />
    </div>
  );
}
