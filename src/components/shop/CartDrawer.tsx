"use client";

import React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import QuantitySelector from "@/components/new/QuantitySelector";
import type { CartItem, CartSummary } from "@/lib/types/cart";

const formatBRL = (value: number) =>
  `R$ ${Number(value).toFixed(2).replace(".", ",")}`;

type CartDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: CartSummary | null;
  loading: boolean;
  onRemove: (itemId: number) => Promise<void>;
  onUpdate: (itemId: number, quantity: number) => Promise<void>;
  /** Re-add a removed item (undo). Optional — without it the undo action is hidden. */
  onReAdd?: (productId: number, quantity: number) => Promise<void>;
};

const CartDrawer = ({
  open,
  onOpenChange,
  summary,
  loading,
  onRemove,
  onUpdate,
  onReAdd,
}: CartDrawerProps) => {
  const router = useRouter();

  const handleCheckout = () => {
    onOpenChange(false);
    router.push("/checkout");
  };

  const handleRemove = async (item: CartItem) => {
    const previousItems = summary?.items;
    // Optimistic removal — update local state immediately
    onRemove(item.id).catch(() => {
      // Restore on failure
      if (previousItems) {
        toast.error("Erro ao remover item", { duration: 3000 });
      }
    });
    toast.success("Produto removido do carrinho", {
      action: {
        label: "Desfazer",
        onClick: () => {
          onReAdd?.(item.product_id, item.quantity).catch(() => {
            toast.error("Erro ao re-adicionar o produto", { duration: 3000 });
          });
        },
      },
      duration: 5000,
    });
  };

  const handleQuantityChange = (itemId: number, quantity: number) => {
    onUpdate(itemId, quantity).catch((err: Error) => {
      toast.error(err.message || "Estoque insuficiente", { duration: 3000 });
    });
  };

  if (loading) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[400px] sm:w-[420px] p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>Seu carrinho</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 py-2">
                <Skeleton className="h-16 w-16 rounded-md flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const items = summary?.items ?? [];
  const itemCount = summary?.itemCount ?? 0;
  const subtotal = summary?.subtotal ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[420px] p-0">
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="flex items-center gap-2">
            Seu carrinho
            {itemCount > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({itemCount} {itemCount === 1 ? "item" : "itens"})
              </span>
            )}
          </SheetTitle>
        </SheetHeader>

        {items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center px-6 py-12">
            <div className="text-center space-y-4">
              <div className="mx-auto w-24 h-24 rounded-full bg-gradient-to-br from-purple-600/20 to-fuchsia-600/10 flex items-center justify-center">
                <span className="text-4xl opacity-60">&#128722;</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-200">
                  Seu carrinho está vazio
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Explore a loja e adicione produtos para começar.
                </p>
              </div>
              <Button
                variant="ghost"
                className="border border-slate-600 hover:bg-slate-700 text-slate-200"
                onClick={() => {
                  onOpenChange(false);
                  router.push("/loja");
                }}
              >
                Explorar loja
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2 space-y-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-3 py-2 border-b border-slate-800 last:border-0"
                >
                  <div className="relative h-16 w-16 rounded-md overflow-hidden bg-slate-800 flex-shrink-0">
                    {item.img_product ? (
                      <Image
                        src={item.img_product}
                        alt={item.product_name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-full w-full bg-slate-700 flex items-center justify-center text-xs text-muted-foreground">
                        &#128247;
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {item.product_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatBRL(item.unit_price)}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <QuantitySelector
                        maxQuantity={Infinity}
                        initialValue={item.quantity}
                        onChange={(qty: number) =>
                          handleQuantityChange(item.id, qty)
                        }
                      />
                      <button
                        onClick={() => void handleRemove(item)}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        aria-label="Remover item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Subtotal: {formatBRL(item.total_price)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <SheetFooter className="p-4 border-t border-slate-800">
            <div className="w-full space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold text-slate-200">
                  {formatBRL(subtotal)}
                </span>
              </div>
              <Button
                className="w-full h-10 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white border border-green-700"
                onClick={handleCheckout}
              >
                Ir para o checkout
              </Button>
              <Button
                variant="ghost"
                className="w-full h-10 border border-slate-600 text-slate-300 hover:bg-slate-700"
                onClick={() => onOpenChange(false)}
              >
                Continuar comprando
              </Button>
            </div>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};

export { CartDrawer };
