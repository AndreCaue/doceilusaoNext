"use client";

// Admin product create/edit form (STORE-05). Port of the SPA BaralhoForm
// (Frontend/src/Pages/Especial/Formularios/BaralhoForm.tsx) using react-hook-form +
// Zod per UI-SPEC Admin Product Form layout. All writes go through the proxy
// route handlers (`/api/admin/products`), preserving Python single-writer for
// product data (D-11) — Next.js orchectrates forms only, no direct Prisma writes.
//
// Master scoping: this form lives under the (admin) layout gate (D-15), and every
// target API route re-verifies master scope server-side (T-27-06-01/02/03).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Form } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { InputForm } from "@/components/new/InputForm";
import { DropdownForm, type IDropdownOption } from "@/components/new/DropdownForm";
import { UploadImage } from "@/components/new/Dropzone";
import type { CatalogProduct } from "@/lib/types/catalog";

const formSchema = z.object({
  name: z.string().min(1, "Obrigatório"),
  description: z.string().min(1, "Obrigatório"),
  stock: z.string().min(1, "Obrigatório"),
  price: z.string().min(1, "Obrigatório"),
  category_id: z.number(),
  models: z.number().refine((v) => v > 0, { message: "Obrigatório" }),
  weight_grams: z.number(),
  height_cm: z.number(),
  width_cm: z.number(),
  length_cm: z.number(),
  discount: z.number(),
  images_urls: z.array(
    z.object({
      name: z.string().min(1, "Nome do arquivo é obrigatório"),
      url: z.string().url("URL inválida"),
      file: z
        .instanceof(File, { message: "Deve ser um arquivo válido" })
        .refine((file) => file.size <= 5 * 1024 * 1024, "Arquivo muito grande (máx. 5MB)")
        .refine((file) => file.type.startsWith("image/"), "Apenas arquivos de imagem são permitidos"),
    }),
  ) as z.ZodType<{ name: string; url: string; file: File }[]>,
});

type TForm = z.infer<typeof formSchema>;

type TProductForm = {
  mode: "create" | "edit";
  seed?: CatalogProduct;
};

export function ProductForm({ mode, seed }: TProductForm) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categories, setCategories] = useState<IDropdownOption[]>([]);
  const [presets, setPresets] = useState<IDropdownOption[]>([]);
  // Edit mode: existing image URLs (kept vs removed).
  const [existingImages] = useState<string[]>(seed?.image_urls ?? []);
  // Edit mode: indices of removed existing images.
  const [deletedIndices, setDeletedIndices] = useState<number[]>([]);

  const form = useForm<TForm>({
    resolver: zodResolver(formSchema),
    defaultValues: seed
      ? {
          name: seed.name,
          description: seed.description ?? "",
          stock: String(seed.stock),
          price: String(seed.price),
          category_id: seed.category_id,
          models: seed.shipping_preset_id ?? (0 as number),
          weight_grams: seed.weight_grams ?? 0,
          height_cm: seed.height_cm ?? 0,
          width_cm: seed.width_cm ?? 0,
          length_cm: seed.length_cm ?? 0,
          discount: seed.discount ?? 0,
          images_urls: [],
        }
      : {
          name: "",
          description: "",
          stock: "",
          price: "",
          category_id: undefined as unknown as number,
          models: undefined as unknown as number,
          discount: 0,
        },
  });

  const { control, handleSubmit, setValue } = form;

  const loadDropdowns = async () => {
    try {
      const [catRes, presetRes] = await Promise.all([
        fetch("/api/admin/dropdown/category"),
        fetch("/api/admin/dropdown/shipping-presets"),
      ]);

      if (catRes.ok) {
        const data = (await catRes.json()) as { id: number; descricao: string }[];
        setCategories(
          data.map((c) => ({ value: c.id, text: c.descricao })),
        );
      }
      if (presetRes.ok) {
        const data = (await presetRes.json()) as { id: number; name: string }[];
        setPresets(data.map((p) => ({ value: p.id, text: p.name })));
      }
    } catch {
      toast.error("Erro ao carregar as opções do formulário.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    loadDropdowns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // handleChangePresets (ported from SPA BaralhoForm): on preset select, fetch the
  // preset details and autofill height/length/weight/width/discount.
  const handleChangePresets = async (v: number | null) => {
    if (!v) {
      setValue("height_cm", 0 as number);
      setValue("length_cm", 0 as number);
      setValue("weight_grams", 0 as number);
      setValue("width_cm", 0 as number);
      setValue("discount", 0);
      return;
    }

    try {
      const res = await fetch(`/api/admin/dropdown/shipping-presets/${v}`);
      if (!res.ok) return;
      const preset = (await res.json()) as {
        id: number;
        height_cm: number;
        length_cm: number;
        weight_grams: number;
        width_cm: number;
        discount?: number;
      };
      setValue("models", preset.id);
      setValue("height_cm", preset.height_cm);
      setValue("length_cm", preset.length_cm);
      setValue("weight_grams", preset.weight_grams);
      setValue("width_cm", preset.width_cm);
      setValue("discount", preset.discount ?? 0);
    } catch {
      toast.error("Erro ao carregar o modelo de envio.");
    }
  };

  const removeExistingImage = (index: number) => {
    setDeletedIndices((prev) =>
      prev.includes(index) ? prev : [...prev, index],
    );
  };

  const undoRemoveExistingImage = (index: number) => {
    setDeletedIndices((prev) => prev.filter((i) => i !== index));
  };

  const onSubmit = async (values: TForm) => {
    setIsSubmitting(true);

    // Client-side completeness check (T-27-06-02): react-hook-form + Zod already
    // block invalid submits, but surface the required-fields toast for missing
    // category/model since those are number fields not covered by .min().
    if (!values.category_id || !values.models) {
      toast.error("Preencha todos os campos obrigatórios.");
      setIsSubmitting(false);
      return;
    }

    const formData = new FormData();
    formData.append("name", values.name);
    formData.append("description", values.description);
    formData.append("price", String(Number(values.price)));
    formData.append("stock", String(Number(values.stock)));
    formData.append("category_id", String(values.category_id));
    formData.append("preset_id", String(values.models));
    formData.append("weight_grams", String(values.weight_grams));
    formData.append("height_cm", String(values.height_cm));
    formData.append("width_cm", String(values.width_cm));
    formData.append("length_cm", String(values.length_cm));
    formData.append("discount", String(values.discount));

    // Newly uploaded files.
    values.images_urls?.forEach((imgObj) => {
      if (imgObj.file instanceof File) {
        formData.append("images", imgObj.file);
      }
    });

    // Edit-mode image semantics (D-11): appending is the default; replacing is opt-in ONLY.
    // Never auto-set replace_images — the backend deletes every kept image it does not
    // see in the new list, so an auto-true on any upload silently destroys existing images.
    if (mode === "edit") {
      // delete_image_indices: removed existing image indices. FastAPI parses list
      // form fields from repeated keys — one "delete_image_indices" entry per index
      // (SPA contract), NOT a single JSON-stringified value (that gets a 422).
      if (deletedIndices.length > 0) {
        deletedIndices.forEach((idx) => {
          formData.append("delete_image_indices", String(idx));
        });
      }
    }

    const url = mode === "edit" && seed ? `/api/admin/products/${seed.id}` : "/api/admin/products";
    const method = mode === "edit" ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        body: formData,
        // Do NOT set Content-Type for FormData — the browser sets the multipart boundary.
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Erro ao salvar o produto. Tente novamente.");
        return;
      }

      toast.success(mode === "edit" ? "Item atualizado." : "Item cadastrado.");
      router.push("/admin/loja");
    } catch {
      toast.error("Erro ao salvar o produto. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit, () => toast.error("Preencha todos os campos obrigatórios."))}>
        <div className="flex flex-col gap-4">
          <UploadImage
            name="images_urls"
            control={control}
            maxFiles={5}
            className="mb-5"
            isSkeletonLoading={isLoading}
          />

          {mode === "edit" && existingImages.length > 0 && (
            <div className="mb-4">
              <Label>Imagens atuais</Label>
              <div className="mt-2 grid grid-cols-2 gap-4">
                {existingImages
                  .map((url, index) => ({ url, index }))
                  .filter(({ index }) => !deletedIndices.includes(index))
                  .map(({ url, index }) => (
                    <div
                      key={index}
                      className="relative flex flex-col items-center p-2 border border-gray-600 rounded-lg bg-gray-800"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={`Imagem ${index + 1}`} className="h-16 w-16 object-cover rounded" />
                      <button
                        type="button"
                        onClick={() => removeExistingImage(index)}
                        className="mt-2 text-sm text-red-400 hover:text-red-300"
                      >
                        Remover
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {mode === "edit" && deletedIndices.length > 0 && (
            <div className="mb-4">
              <Label>Imagens removidas</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {deletedIndices.map((idx) => (
                  <Button
                    key={idx}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => undoRemoveExistingImage(idx)}
                  >
                    Restaurar imagem {idx + 1}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <InputForm
            control={control}
            label="Nome do Produto"
            name="name"
            required
            background="dark"
            disabled={isSubmitting}
            className="w-full"
            isSkeletonLoading={isLoading}
          />
          <InputForm
            control={control}
            label="Descrição do Produto"
            name="description"
            className="mt-1"
            background="dark"
            disabled={isSubmitting}
            required
            isSkeletonLoading={isLoading}
          />
          <div className="grid lg:flex gap-4 mt-1">
            <InputForm
              control={control}
              label="Quantidade"
              name="stock"
              background="dark"
              className="lg:w-1/2"
              disabled={isSubmitting}
              required
              isSkeletonLoading={isLoading}
            />
            <InputForm
              control={control}
              label="Preço"
              name="price"
              className="lg:w-1/2"
              background="dark"
              disabled={isSubmitting}
              required
              isSkeletonLoading={isLoading}
            />
          </div>

          <div className="lg:flex w-full gap-4 mt-1">
            <DropdownForm
              control={control}
              label="Categoria"
              required
              disabled={isSubmitting}
              className="w-full"
              name="category_id"
              options={categories}
              isSkeletonLoading={isLoading}
            />
            <DropdownForm
              control={control}
              label="Selecionar Modelo"
              required
              disabled={isSubmitting}
              className="w-full"
              name="models"
              onChangeValue={handleChangePresets}
              options={presets}
              isSkeletonLoading={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
            <InputForm
              control={control}
              label="Peso em Gramas"
              name="weight_grams"
              background="dark"
              disabled
              required
              isSkeletonLoading={isLoading}
            />
            <InputForm
              control={control}
              label="Altura (cm)"
              name="height_cm"
              background="dark"
              required
              disabled
              isSkeletonLoading={isLoading}
            />
            <InputForm
              control={control}
              label="Largura (cm)"
              background="dark"
              name="width_cm"
              required
              disabled
              isSkeletonLoading={isLoading}
            />
            <InputForm
              control={control}
              label="Comprimento"
              background="dark"
              name="length_cm"
              required
              disabled
              isSkeletonLoading={isLoading}
            />
            <InputForm
              control={control}
              label="Deseja aplicar desconto?"
              background="dark"
              name="discount"
              required
              disabled
              isSkeletonLoading={isLoading}
            />
          </div>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full lg:w-auto mt-2"
          disabled={isSubmitting}
        >
          {mode === "edit" ? "Salvar alterações" : "Cadastrar item"}
        </Button>
      </form>
    </Form>
  );
}
