// Cart page — Server Component shell (CART-03).
// Renders the dark gradient background + DisplayHeader, then delegates to the
// CartPage client component which owns all data fetching via useCart.
// Note: useCart resolves the active cart through GET /api/cart (auth cookie),
// so this shell needs no server-side cart read.

import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import { CartPage } from "@/components/shop/CartPage";

export default function CarrinhoPage() {
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 py-30 max-w-6xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Seu carrinho"
          subTitle="Revise os itens e finalize sua compra"
        />

        <CartPage />
      </div>
    </div>
  );
}