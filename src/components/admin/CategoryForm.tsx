"use client";

// Admin category create/edit form (STORE-06). Port of the SPA CategoriaForm
// (Frontend/src/Pages/Especial/Formularios/CategoryForm.tsx) using react-hook-form +
// Zod per UI-SPEC Admin Category CRUD layout. All writes go through the proxy
// route handlers (/api/admin/categories), preserving Python single-writer for
// category data (D-11) — Next.js orchestrates forms only, no direct Prisma writes.
//
// Master scoping: this form lives under the (admin) layout gate (D-15), and every
// target API route re-verifies master scope server-side (T-27-07-01).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { InputForm } from "@/components/new/InputForm";
import type { CatalogCategory } from "@/lib/types/catalog";

const formSchema = z.object({
  name: z.string().min(1, "Obrigatório"),
  description: z.string().optional(),
  website: z.string().optional(),
});

type TForm = z.infer<typeof formSchema>;

type TCategoryForm = {
  mode: "create" | "edit";
  seed?: CatalogCategory;
};

export function CategoryForm({ mode, seed }: TCategoryForm) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<TForm>({
    resolver: zodResolver(formSchema),
    defaultValues: seed
      ? {
          name: seed.name,
          description: seed.description ?? "",
          website: seed.website ?? "",
        }
      : { name: "", description: "", website: "" },
  });

  const { handleSubmit, control } = form;

  const onSubmit = async (values: TForm) => {
    // UI-SPEC copy: "Preencha todos os campos obrigatórios."
    if (!values.name || values.name.trim().length === 0) {
      toast.error("Preencha todos os campos obrigatórios.");
      return;
    }

    setIsSubmitting(true);
    try {
      const url =
        mode === "edit" && seed
          ? `/api/admin/categories/${seed.id}`
          : "/api/admin/categories";
      const method = mode === "edit" ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          description: values.description?.trim() || undefined,
          website: values.website?.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(
          body?.error ?? "Erro ao salvar categoria. Tente novamente mais tarde.",
        );
        return;
      }

      // UI-SPEC copy: "Categoria cadastrada."
      toast.success("Categoria cadastrada.");
      router.push("/admin/loja/categorias");
      router.refresh();
    } catch {
      toast.error("Erro ao salvar categoria. Tente novamente mais tarde.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <InputForm
          control={control}
          name="name"
          label="Nome da Categoria"
          required
          background="dark"
          className="w-full"
          disabled={isSubmitting}
        />
        <InputForm
          control={control}
          name="description"
          label="Descrição"
          background="dark"
          className="w-full"
          disabled={isSubmitting}
        />
        <InputForm
          control={control}
          name="website"
          label="URL"
          background="dark"
          className="w-full"
          disabled={isSubmitting}
        />

        <Button type="submit" disabled={isSubmitting} className="w-fit">
          {mode === "edit" ? "Salvar Alterações" : "Cadastrar Categoria"}
        </Button>
      </form>
    </Form>
  );
}
