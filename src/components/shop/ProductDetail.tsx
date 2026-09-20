"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, CreditCard, Info } from "lucide-react";
import { toast } from "sonner";
import { NewButton } from "@/components/new/NewButton";
import QuantitySelector from "@/components/new/QuantitySelector";
import { CartDrawer } from "@/components/shop/CartDrawer";
import { useCart } from "@/hooks/useCart";
import { useAuth } from "@/hooks/useAuth";
import type { CatalogProduct } from "@/lib/types/catalog";

type TProductDetail = {
  product: CatalogProduct;
};

/**
 * Product detail right column (STORE-02).
 *
 * Renders name, stock metadata, price/installments, QuantitySelector, and the
 * two cart CTAs — "Comprar agora" / "Adicionar ao carrinho". Phase 28 wires
 * real cart hooks: add-to-cart opens the CartDrawer with a success toast;
 * buy-now adds to cart and navigates directly to /checkout. Unauthenticated
 * users see a login prompt toast (UI-SPEC Q2). Disabled when out of stock.
 */
export const ProductDetail = ({ product }: TProductDetail) => {
  const [quantity, setQuantity] = useState<number>(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { addItem, buyNow, summary, loading, removeItem, updateItem } = useCart();
  const { isGuest } = useAuth();
  const router = useRouter();

  const requireAuth = (action: () => void) => {
    if (isGuest) {
      toast("Faça login para adicionar ao carrinho", {
        action: {
          label: "Fazer login",
          onClick: () =>
            router.push(`/login?redirect=/loja/produto/${product.id}`),
        },
        duration: 6000,
      });
      return;
    }
    action();
  };

  const handleAddToCart = () =>
    requireAuth(async () => {
      try {
        await addItem(product.id, quantity);
        toast.success("Produto adicionado ao carrinho");
        setDrawerOpen(true);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Estoque insuficiente",
        );
      }
    });

  const handleBuyNow = () =>
    requireAuth(async () => {
      try {
        const path = await buyNow(product.id, quantity);
        router.push(path);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Estoque insuficiente",
        );
      }
    });

  const parcelas = Math.floor(product.price / 10) || 1;
  const hasValidStock = product.stock > product.reserved_stock;
  const remainStock = product.stock - product.reserved_stock;
  const outOfStock = product.stock === 0 || !hasValidStock;

  return (
    <div className="flex flex-col justify-between">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-400">{product.name}</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Vendidos: {product.reserved_stock} - • Em estoque:{" "}
            <b className="text-green-400">{remainStock}</b> unidades
          </p>
        </div>

        <div className="border-b pb-6">
          <div className="text-4xl font-bold text-slate-200">
            R$ {Number(product.price).toFixed(2).replace(".", ",")}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            até <b className="text-slate-200">{parcelas}x</b> no cartão.
          </p>
          <p className="text-sm text-muted-foreground mt-2 flex gap-2">
            <Info size={20} /> valor mínimo da parcela 10 reais.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-400">
              Quantidade:
            </span>
            <QuantitySelector
              maxQuantity={remainStock}
              initialValue={quantity}
              onChange={setQuantity}
              disabled={outOfStock}
            />
          </div>
        </div>

        {outOfStock && (
          <div className="rounded-lg bg-red-500 text-white text-sm font-medium px-4 py-3">
            Estoque indisponível no momento.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
          <NewButton
            label="Comprar agora"
            onClick={handleBuyNow}
            disabled={outOfStock}
            className="h-10 text-lg font-semibold"
          />
          <NewButton
            label="Adicionar ao carrinho"
            icon={<ShoppingCart className="w-5 h-5" />}
            onClick={handleAddToCart}
            disabled={outOfStock}
            className="h-10 text-lg"
          />
        </div>

        <div className="space-y-3 pt-6 border-t text-sm text-muted-foreground">
          <div className="flex items-center gap-3">
            <CreditCard className="w-5 h-5" />
            <span>
              Parcele até em <b className="text-green-400">3x</b> sem juros{" "}
            </span>
          </div>
        </div>
      </div>

      {product.description && (
        <div className="mt-10 pt-8 border-t">
          <h3 className="font-semibold text-slate-400 text-lg mb-3">
            Descrição
          </h3>
          <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {product.description}
          </p>
        </div>
      )}

      <CartDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        summary={summary}
        loading={loading}
        onRemove={removeItem}
        onUpdate={updateItem}
        onReAdd={addItem}
      />
    </div>
  );
};
