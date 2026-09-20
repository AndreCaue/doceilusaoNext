"use client";

// Admin category list table (STORE-06). Renders categories read via Prisma (D-02)
// with name, description, website, product count, and per-row actions:
// Edit link, Delete (AlertDialog with Python product-reference guard message D-14),
// and up/down reorder buttons (D-13) calling POST /api/admin/categories/reorder.
//
// Threat T-27-07-04: reorder validates id and direction server-side.
// Threat T-27-07-03: delete propagates Python's 400 guard message to the UI.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import type { CatalogCategory } from "@/lib/types/catalog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function CategoryList({ categories }: { categories: CatalogCategory[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [reorderingId, setReorderingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // D-14: Python's product-reference guard returns 400 with a message.
        // Surface it to the admin so they know why the delete was blocked.
        toast.error(body?.error ?? "Erro ao excluir categoria. Tente novamente mais tarde.");
        return;
      }
      toast.success("Categoria excluída com sucesso.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Erro ao excluir categoria. Tente novamente mais tarde.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleReorder = async (id: number, direction: "up" | "down") => {
    setReorderingId(id);
    try {
      const res = await fetch("/api/admin/categories/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, direction }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Erro ao reordenar categorias. Tente novamente mais tarde.");
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      toast.error("Erro ao reordenar categorias. Tente novamente mais tarde.");
    } finally {
      setReorderingId(null);
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12" />
          <TableHead>Nome</TableHead>
          <TableHead>Descrição</TableHead>
          <TableHead>URL</TableHead>
          <TableHead className="text-center">Produtos</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {categories.map((category, index) => (
          <TableRow key={category.id}>
            {/* Up/down reorder buttons (D-13) */}
            <TableCell>
              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={index === 0 || reorderingId === category.id}
                  onClick={() => handleReorder(category.id, "up")}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  disabled={index === categories.length - 1 || reorderingId === category.id}
                  onClick={() => handleReorder(category.id, "down")}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            </TableCell>
            <TableCell className="font-medium">{category.name}</TableCell>
            <TableCell className="max-w-[200px] truncate text-muted-foreground">
              {category.description ?? "-"}
            </TableCell>
            <TableCell>
              {category.website ? (
                <a
                  href={category.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {category.website}
                </a>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </TableCell>
            <TableCell className="text-center">{category.productCount ?? 0}</TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/admin/loja/categorias/${category.id}/editar`}>
                    <Pencil className="size-4" />
                    Editar
                  </a>
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletingId === category.id}
                    >
                      <Trash2 className="size-4" />
                      Excluir
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir categoria</AlertDialogTitle>
                      <AlertDialogDescription>
                        Excluir categoria: Produtos desta categoria não serão removidos.
                        Confirmar exclusão?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(category.id)}
                      >
                        Confirmar exclusão
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
