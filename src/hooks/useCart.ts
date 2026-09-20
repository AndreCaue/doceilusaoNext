"use client";

// useCart — lightweight cart state hook backed by /api/cart.
// Fetches the active cart summary on mount and exposes add/remove/update
// mutations that refetch after each call. All requests use credentials: "include"
// for cookie-based auth (D-01). 401s are swallowed silently — the caller is
// responsible for auth prompts (UI-SPEC Q2).

import { useCallback, useEffect, useState } from "react";
import type { CartSummary } from "@/lib/types/cart";

function isCartSummary(data: unknown): data is CartSummary {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.id === "number" &&
    Array.isArray(obj.items) &&
    typeof obj.itemCount === "number"
  );
}

const useCart = () => {
  const [summary, setSummary] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/cart", { credentials: "include" });
      if (!res.ok) return; // 401 = guest, silently ignore
      const data = await res.json();
      if (isCartSummary(data)) {
        setSummary(data);
      }
    } catch {
      // Network error — keep previous state
    }
  }, []);

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  const addItem = useCallback(
    async (productId: number, quantity = 1) => {
      const res = await fetch("/api/cart/add", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Erro ao adicionar ao carrinho",
        );
      }
      await refetch();
    },
    [refetch],
  );

  const buyNow = useCallback(
    async (productId: number, quantity = 1): Promise<string> => {
      const res = await fetch("/api/cart/add", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Erro ao adicionar ao carrinho",
        );
      }
      return "/checkout";
    },
    [],
  );

  const removeItem = useCallback(
    async (itemId: number) => {
      const res = await fetch("/api/cart/remove", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Erro ao remover item",
        );
      }
      await refetch();
    },
    [refetch],
  );

  const updateItem = useCallback(
    async (itemId: number, quantity: number) => {
      const res = await fetch("/api/cart/update", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, quantity }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? "Erro ao atualizar carrinho",
        );
      }
      await refetch();
    },
    [refetch],
  );

  return { summary, loading, addItem, buyNow, removeItem, updateItem, refetch };
};

export { useCart };
