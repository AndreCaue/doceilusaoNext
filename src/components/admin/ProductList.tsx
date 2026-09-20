"use client";

// Admin product list table (STORE-05). Renders products read via Prisma (D-02)
// with image thumb, name, category, price, stock/remaining, and Edit/Delete
// actions. Delete confirms via shadcn AlertDialog then proxies to
// DELETE /api/admin/products/[id] and refreshes (T-27-06-04).

import { useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogProduct } from "@/lib/types/catalog";
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

function formatPrice(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

export function ProductList({ products }: { products: CatalogProduct[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? "Erro ao excluir produto. Tente novamente mais tarde.");
        return;
      }
      toast.success("Produto removido com sucesso.");
      startTransition(() => router.refresh());
    } catch {
      toast.error("Erro ao excluir produto. Tente novamente mais tarde.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">Imagem</TableHead>
          <TableHead>Nome</TableHead>
          <TableHead>Categoria</TableHead>
          <TableHead>Preço</TableHead>
          <TableHead>Estoque</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product) => (
          <TableRow key={product.id}>
            <TableCell>
              {product.image_urls?.[0] ? (
                <Image
                  src={product.image_urls[0]}
                  alt={product.name}
                  width={48}
                  height={48}
                  className="h-12 w-12 rounded-md object-cover"
                />
              ) : (
                <div className="h-12 w-12 rounded-md bg-muted" />
              )}
            </TableCell>
            <TableCell className="font-medium">{product.name}</TableCell>
            <TableCell>{product.category?.name ?? "-"}</TableCell>
            <TableCell>{formatPrice(product.price)}</TableCell>
            <TableCell>
              <span
                className={cn(
                  product.remainingStock <= 0
                    ? "text-destructive"
                    : "text-green-600",
                )}
              >
                {product.remainingStock} restantes
              </span>
              <span className="text-muted-foreground"> / {product.stock}</span>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={`/admin/loja/produtos/${product.id}/editar`}>
                    <Pencil className="size-4" />
                    Editar
                  </a>
                </Button>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletingId === product.id}
                    >
                      <Trash2 className="size-4" />
                      Excluir
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Excluir produto</AlertDialogTitle>
                      <AlertDialogDescription>
                        Excluir produto: Esta ação não pode ser desfeita. Confirmar
                        exclusão?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(product.id)}
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
