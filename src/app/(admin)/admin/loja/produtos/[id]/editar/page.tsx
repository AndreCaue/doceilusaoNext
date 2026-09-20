// Admin product edit page (STORE-05) — async Server Component that reads the
// product via getCatalogProductById (Prisma D-02) to pre-fill the ProductForm in
// edit mode. 404s on missing/invalid id (T-27-05-01 pattern). Writes proxy to
// Python (D-11); no direct Prisma writes.
import { notFound } from "next/navigation";
import { getCatalogProductById } from "@/lib/catalog";
import { ProductForm } from "@/components/admin/ProductForm";

type TParams = { id: string };

export default async function EditProductPage({ params }: { params: Promise<TParams> }) {
  const { id: rawId } = await params;
  const trimmed = rawId?.trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== trimmed) {
    notFound();
  }

  const product = await getCatalogProductById(parsed);
  if (!product) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Editar produto</h1>
      <ProductForm mode="edit" seed={product} />
    </div>
  );
}
