// Cart service module — single source of cart business logic (D-01, D-02).
// All cart operations are Prisma-direct (RESEARCH §7.3): find-or-create active
// cart by user_id, add/update/remove items with stock validation, and return
// the cart summary. All functions accept uuid (from getCurrentUser) and resolve
// the numeric user_id internally.
//
// Threat mitigations:
//   T-28-02-01: getCurrentUser enforces auth on all 4 endpoints (route layer)
//   T-28-02-02: All queries scoped by user_id; item lookups verify cart.user_id
//   T-28-02-03: Server-side stock validation on add/update; product.stock queried fresh
//   T-28-02-04: zod schemas at route entry (quantity >= 1, product_id positive int)

import { prisma } from "@/lib/prisma";
import type { CartSummary } from "./types/cart";

// ─── Cart error type ──────────────────────────────────────────
/** Typed error for cart operations — route handlers catch and map to D-12 shape. */
export class CartError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "CartError";
  }
}

// ─── Internal helpers ─────────────────────────────────────────

/** Resolve numeric user id from UUID (Prisma Cart.user_id is Int). */
async function resolveUserId(uuid: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { uuid },
    select: { id: true },
  });
  if (!user) {
    throw new CartError("Usuário não encontrado", 404, "USER_NOT_FOUND");
  }
  return user.id;
}

/** Find-or-create the active cart for a numeric user_id. */
async function findOrCreateActiveCart(userId: number) {
  const existing = await prisma.cart.findFirst({
    where: { user_id: userId, status: "active" },
  });
  if (existing) return existing;

  return prisma.cart.create({
    data: { user_id: userId, status: "active" },
  });
}

/** Build a CartSummary from a cart with its items (in-memory aggregation). */
async function buildSummary(cartId: number): Promise<CartSummary> {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    include: { items: true },
  });
  if (!cart) {
    throw new CartError("Carrinho não encontrado", 404, "CART_NOT_FOUND");
  }

  const items = cart.items.map((i) => ({
    id: i.id,
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity ?? 0,
    unit_price: i.unit_price,
    total_price: i.total_price,
    img_product: i.img_product,
    discount: i.discount,
    sku: i.sku,
  }));

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.total_price, 0);
  const discount = items.reduce((sum, i) => sum + (i.discount ?? 0), 0);
  const total = subtotal - discount;

  return { id: cart.id, items, itemCount, subtotal, discount, total };
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Find or create the active cart for a user (by uuid).
 * Returns the cart record (with id).
 */
export async function findOrCreateActiveCartByUuid(uuid: string) {
  const userId = await resolveUserId(uuid);
  return findOrCreateActiveCart(userId);
}

/**
 * Add an item to the active cart.
 * - Validates product exists (404)
 * - Validates stock (400)
 * - If item already in cart → increment quantity (re-validate stock)
 * - Else → create with unit_price snapshot
 * Returns updated cart summary.
 */
export async function addItem(
  uuid: string,
  productId: number,
  quantity: number,
): Promise<CartSummary> {
  const userId = await resolveUserId(uuid);
  const cart = await findOrCreateActiveCart(userId);

  // Validate product exists
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });
  if (!product) {
    throw new CartError("Produto não encontrado", 404, "NOT_FOUND");
  }

  // Validate stock (T-28-02-03: fresh from DB each time; align with checkout's
  // available-stock check — only stock minus reserved_stock is purchasable)
  const availableStock = product.stock - (product.reserved_stock ?? 0);
  if (availableStock < quantity) {
    throw new CartError("Estoque insuficiente", 400, "INSUFFICIENT_STOCK");
  }

  // Check if item already in cart for this product
  const existingItem = await prisma.cartItem.findFirst({
    where: { cart_id: cart.id, product_id: productId },
  });

  if (existingItem) {
    const newQty = (existingItem.quantity ?? 0) + quantity;
    // Re-validate stock after increment
    if (availableStock < newQty) {
      throw new CartError("Estoque insuficiente", 400, "INSUFFICIENT_STOCK");
    }
    await prisma.cartItem.update({
      where: { id: existingItem.id },
      data: {
        quantity: newQty,
        total_price: existingItem.unit_price * newQty,
      },
    });
  } else {
    // Snapshot unit_price at add time
    const imgUrls = product.image_urls;
    const firstImage = Array.isArray(imgUrls) && imgUrls.length > 0
      ? (imgUrls[0] as string)
      : null;

    await prisma.cartItem.create({
      data: {
        cart_id: cart.id,
        product_id: product.id,
        product_name: product.name,
        quantity,
        unit_price: product.price,
        total_price: product.price * quantity,
        img_product: firstImage,
        discount: product.discount,
        sku: product.sku,
      },
    });
  }

  return buildSummary(cart.id);
}

/**
 * Update an item's quantity in the active cart.
 * - Verifies item belongs to user's active cart (IDOR guard)
 * - Validates stock (400)
 * - Recalculates total_price
 * Returns updated cart summary.
 */
export async function updateItem(
  uuid: string,
  itemId: number,
  quantity: number,
): Promise<CartSummary> {
  const userId = await resolveUserId(uuid);

  // Find cart item and verify ownership (T-28-02-02: IDOR guard)
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true },
  });
  if (!cartItem || cartItem.cart.user_id !== userId || cartItem.cart.status !== "active") {
    throw new CartError("Item não encontrado no carrinho", 404, "NOT_FOUND");
  }

  // Validate stock (T-28-02-03: fresh from DB; align with checkout's
  // available-stock check — only stock minus reserved_stock is purchasable)
  const product = await prisma.product.findUnique({
    where: { id: cartItem.product_id },
  });
  if (!product) {
    throw new CartError("Produto não encontrado", 404, "NOT_FOUND");
  }
  const availableStock = product.stock - (product.reserved_stock ?? 0);
  if (availableStock < quantity) {
    throw new CartError("Estoque insuficiente", 400, "INSUFFICIENT_STOCK");
  }

  await prisma.cartItem.update({
    where: { id: itemId },
    data: {
      quantity,
      total_price: cartItem.unit_price * quantity,
    },
  });

  return buildSummary(cartItem.cart_id);
}

/**
 * Remove an item from the active cart.
 * - Verifies item belongs to user's active cart (IDOR guard)
 * - Deletes the item
 * Returns updated cart summary.
 */
export async function removeItem(
  uuid: string,
  itemId: number,
): Promise<CartSummary> {
  const userId = await resolveUserId(uuid);

  // Find cart item and verify ownership (T-28-02-02: IDOR guard)
  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true },
  });
  if (!cartItem || cartItem.cart.user_id !== userId || cartItem.cart.status !== "active") {
    throw new CartError("Item não encontrado no carrinho", 404, "NOT_FOUND");
  }

  await prisma.cartItem.delete({ where: { id: itemId } });

  return buildSummary(cartItem.cart_id);
}

/**
 * Get the cart summary for a user.
 * If no active cart exists, returns an empty summary.
 */
export async function getCartSummary(uuid: string): Promise<CartSummary> {
  const userId = await resolveUserId(uuid);

  const cart = await prisma.cart.findFirst({
    where: { user_id: userId, status: "active" },
    include: { items: true },
  });

  if (!cart) {
    return { id: 0, items: [], itemCount: 0, subtotal: 0, discount: 0, total: 0 };
  }

  const items = cart.items.map((i) => ({
    id: i.id,
    product_id: i.product_id,
    product_name: i.product_name,
    quantity: i.quantity ?? 0,
    unit_price: i.unit_price,
    total_price: i.total_price,
    img_product: i.img_product,
    discount: i.discount,
    sku: i.sku,
  }));

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.total_price, 0);
  const discount = items.reduce((sum, i) => sum + (i.discount ?? 0), 0);
  const total = subtotal - discount;

  return { id: cart.id, items, itemCount, subtotal, discount, total };
}
