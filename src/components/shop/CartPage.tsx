"use client";

// Cart page client component (CART-03).
// Owns all data fetching via useCart; renders item rows with QuantitySelector +
// trash actions, totals block with sticky right column, and the
// "Finalizar compra" CTA. Empty state per UI-SPEC copy.

import React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import QuantitySelector from "@/components/new/QuantitySelector";
import { useCart } from "@/hooks/useCart";
import type { CartItem } from "@/lib/types/cart";
import { ActiveOrderBanner } from "./ActiveOrderBanner";
import { useActiveOrder } from "./useActiveOrder";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const CartPage = () => {
  const router = useRouter();
  const { summary, loading, removeItem, updateItem, addItem } = useCart();
  // Revision counter forces QuantitySelector remount with the server value
  // after a rejected quantity update (UI-SPEC: revert on stock error).
  const [revision, setRevision] = useState(0);
  // ORDER-02 gate: single fetch per page; banner + CTA disable derive from it.
  const activeOrder = useActiveOrder();

  const handleQuantityChange = (itemId: number, quantity: number) => {
    updateItem(itemId, quantity).catch(() => {
      toast.error("Estoque insuficiente", { duration: 3000 });
      setRevision((r) => r + 1);
    });
  };

  const handleRemove = (item: CartItem) => {
    removeItem(item.id).catch(() => {
      toast.error("Erro ao remover item", { duration: 3000 });
    });
    toast.success("Produto removido do carrinho", {
      action: {
        label: "Desfazer",
        onClick: () => {
          addItem(item.product_id, item.quantity).catch(() => {
            toast.error("Erro ao re-adicionar o produto", { duration: 3000 });
          });
        },
      },
      duration: 5000,
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-xl bg-neutral-900/60 backdrop-blur p-4 flex gap-4"
          >
            <Skeleton className="h-24 w-24 rounded-md flex-shrink-0" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const items = summary?.items ?? [];
  const subtotal = summary?.subtotal ?? 0;
  const discount = summary?.discount ?? 0;
  const total = summary?.total ?? 0;

  if (!summary || items.length === 0) {
    return (
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 text-center">
          <div className="mx-auto w-28 h-28 rounded-full bg-gradient-to-br from-purple-600/20 to-fuchsia-600/10 flex items-center justify-center mb-6">
            <span className="text-5xl opacity-60">&#128722;</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-light tracking-widest text-white/90">
            Seu carrinho está vazio
          </h2>
          <p className="text-gray-300 mt-4 text-lg">
            Explore a loja e adicione produtos para começar.
          </p>
          <Button className="mt-8 h-10" onClick={() => router.push("/loja")}>
            Explorar loja
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <ActiveOrderBanner {...activeOrder} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Item list — left / main column */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-xl bg-neutral-900/60 backdrop-blur p-4 flex gap-4"
            >
              <div className="relative h-24 w-24 rounded-md overflow-hidden bg-slate-800 flex-shrink-0">
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
                <div className="flex items-start justify-between gap-4">
                  <p className="font-medium text-slate-200">
                    {item.product_name}
                  </p>
                  <button
                    onClick={() => handleRemove(item)}
                    className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                    aria-label="Remover item"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Preço unitário: {formatBRL(item.unit_price)}
                </p>
                <div className="flex items-center justify-between mt-3">
                  <QuantitySelector
                    key={`${item.id}-${item.quantity}-${revision}`}
                    maxQuantity={Infinity}
                    initialValue={item.quantity}
                    onChange={(qty: number) => {
                      if (qty !== item.quantity) {
                        handleQuantityChange(item.id, qty);
                      }
                    }}
                  />
                  <p className="text-base font-semibold text-slate-200">
                    {formatBRL(item.total_price)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Totals block — right column, sticky on lg */}
        <div className="lg:sticky lg:top-24 h-fit">
          <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-6 space-y-4">
            <h3 className="text-xl font-semibold text-slate-200">
              Resumo do pedido
            </h3>

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="text-slate-200">{formatBRL(subtotal)}</span>
            </div>

            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Desconto</span>
                <span className="text-green-400">-{formatBRL(discount)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Frete</span>
              <span className="text-slate-300">calcular no checkout</span>
            </div>

            <div className="border-t border-slate-800 pt-4 flex justify-between items-center">
              <span className="text-xl font-semibold text-slate-200">
                Total
              </span>
              <span className="text-xl font-semibold text-slate-200">
                {formatBRL(total)}
              </span>
            </div>

            <Button
              className="w-full h-10 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white border border-green-700 text-base"
              onClick={() => router.push("/checkout")}
              disabled={activeOrder.hasActive}
              aria-disabled={activeOrder.hasActive}
              title={
                activeOrder.hasActive
                  ? "Você já tem um pedido em andamento"
                  : undefined
              }
            >
              Finalizar compra
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { CartPage };
