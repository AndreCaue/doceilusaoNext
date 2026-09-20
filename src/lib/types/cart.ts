// Shared cart types — single typed contract for all cart API routes and components
// Phase 28 (CART-01..CART-04): Prisma-direct cart model parity with Python backend

export type CartItem = {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  img_product: string | null;
  discount: number | null;
  sku: string | null;
};

export type CartSummary = {
  id: number;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
};
