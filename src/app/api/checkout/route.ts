// POST /api/checkout — order creation with row-locked stock reservation.
//
// Flow parity (RESEARCH §5.2 Python checkout):
//   1. getCurrentUser(req) — enforce auth
//   2. Validate body with zod schema matching CheckoutRequest constraints
//   3. Resolve user id; reject if a live reservation exists (ORDER-02 → 409)
//   4. Find user's active cart (must have items — 400 "Carrinho vazio")
//   5. Prisma interactive transaction with SELECT ... FOR UPDATE row locks
//   6. Revalidate stock for each item: quantity > stock - reserved_stock → reject
//   7. Create Order (PENDING/PENDING, reservation_expires_at = now + 6h per CHECKOUT-03)
//   8. Create OrderItems (snapshot product name, price, quantity)
//   9. Create OrderShipping from address fields
//  10. Increment Product.reserved_stock per item
//  11. Set cart.status = "closed"
//  12. Return { redirect: "/checkout/" + order.uuid, expires_in_seconds: 6h }
//
// Deviation from Python: reservation_expires_at = 6h (not 30 min) — CHECKOUT-03.
// Threat mitigations:
//   T-28-04-01: $transaction + SELECT ... FOR UPDATE row locks prevent oversell
//   T-28-04-02: getCurrentUser enforces auth; order.user_id from token, not body
//   T-28-04-03: Cart locked + closed atomically within transaction
//   T-28-04-04: zod schema at route entry matching pydantic constraints
//   T-30-06-01/02: ORDER-02 gate — 409 ACTIVE_RESERVATION while a reservation
//                  is live (server-enforced, before any cart mutation)

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { getActiveReservation } from "@/lib/orders/queries";
import type { CheckoutResponse } from "@/lib/types/checkout";

// ─── Zod schema — pydantic parity (RESEARCH §5.2) ─────────────
const checkoutSchema = z.object({
  recipient_name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  recipient_document: z
    .string()
    .min(11, "Documento deve ter 11-14 caracteres")
    .max(14, "Documento deve ter 11-14 caracteres"),
  recipient_email: z.string().email("Email inválido"),
  recipient_phone: z
    .string()
    .min(10, "Telefone deve ter 10-15 caracteres")
    .max(15, "Telefone deve ter 10-15 caracteres"),
  street: z.string().min(1, "Rua é obrigatória"),
  number: z.string().min(1, "Número é obrigatório"),
  complement: z.string().optional(),
  neighborhood: z.string().min(1, "Bairro é obrigatório"),
  city: z.string().min(1, "Cidade é obrigatória"),
  state: z
    .string()
    .length(2, "Estado deve ter 2 caracteres (UF)"),
  postal_code: z
    .string()
    .length(8, "CEP deve ter 8 dígitos")
    .regex(/^\d{8}$/, "CEP deve conter apenas dígitos"),
  shipping_option_id: z.number().int().positive("Selecione uma opção de frete"),
  shipping_carrier: z.string().min(1, "Transportadora é obrigatória"),
  shipping_method: z.string().min(1, "Método de envio é obrigatório"),
  shipping_cost: z.number().min(0, "Frete inválido"),
  shipping_original: z.number().min(0, "Frete original inválido"),
  shipping_delivery_days: z.number().int().positive("Prazo inválido"),
  usar_seguro: z.boolean().optional().default(false),
});

const RESERVATION_HOURS = 6;
const RESERVATION_SECONDS = RESERVATION_HOURS * 60 * 60;

export async function POST(req: NextRequest) {
  try {
    const identity = await getCurrentUser(req);

    // Malformed JSON body → 400 BAD_REQUEST (D-12 parity with cart routes)
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "JSON inválido", code: "BAD_REQUEST", retryable: false },
        { status: 400 },
      );
    }
    const parsed = checkoutSchema.safeParse(rawBody);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message ?? "Dados inválidos";
      return NextResponse.json(
        { error: firstError, code: "VALIDATION_ERROR", retryable: false },
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Resolve numeric user id from uuid (needed for Prisma queries)
    const dbUser = await prisma.user.findUnique({
      where: { uuid: identity.uuid },
      select: { id: true },
    });
    if (!dbUser) {
      return NextResponse.json(
        { error: "Usuário não encontrado", code: "USER_NOT_FOUND", retryable: false },
        { status: 401 },
      );
    }

    // ORDER-02 gate: one reservation at a time — a live unpaid order blocks
    // new checkouts while it is reserved (T-30-06-01/02, server-enforced
    // BEFORE any cart read or mutation — the client banner is cosmetic only).
    const active = await getActiveReservation(dbUser.id);
    if (active.success) {
      return NextResponse.json(
        { error: active.message, code: "ACTIVE_RESERVATION", retryable: false },
        { status: 409 },
      );
    }

    // Find the active cart with items
    const cart = await prisma.cart.findFirst({
      where: { user_id: dbUser.id, status: "active" },
      include: { items: true },
    });

    if (!cart || cart.items.length === 0) {
      return NextResponse.json(
        { error: "Carrinho vazio", code: "EMPTY_CART", retryable: false },
        { status: 400 },
      );
    }

    // Resolve unique product IDs from cart items for row locking
    const productIds = [...new Set(cart.items.map((i) => i.product_id))];

    // ─── Prisma interactive transaction with row locks (T-28-04-01) ───
    const order = await prisma.$transaction(async (tx) => {
      // Lock products referenced by cart items: SELECT ... FOR UPDATE
      // $queryRaw returns rows — we lock them and verify stock
      const lockedProducts = await tx.$queryRaw<
        Array<{
          id: number;
          stock: number;
          reserved_stock: number | null;
        }>
      >`
        SELECT id, stock, reserved_stock
        FROM products
        WHERE id IN (${Prisma.join(productIds)})
        FOR UPDATE
      `;

      // Build a lookup map for locked products
      const productMap = new Map(
        lockedProducts.map((p) => [p.id, p]),
      );

      // Revalidate stock for each item (T-28-04-01: prevent oversell)
      for (const item of cart.items) {
        const product = productMap.get(item.product_id);
        if (!product) {
          throw new Error(`Produto não encontrado: ${item.product_id}`);
        }

        const itemQty = item.quantity ?? 0;
        const availableStock =
          product.stock - (product.reserved_stock ?? 0);
        if (itemQty > availableStock) {
          throw new Error(
            `Estoque insuficiente para "${item.product_name}". Disponível: ${availableStock}`,
          );
        }
      }

      // Calculate totals (use DB-computed cart totals, not stale request data)
      const subtotal = cart.items.reduce((s, i) => s + i.total_price, 0);
      const discount = cart.items.reduce(
        (s, i) => s + (i.discount ?? 0),
        0,
      );
      const total = subtotal - discount + data.shipping_cost;

      // Create the Order
      const orderUuid = crypto.randomUUID();
      const reservationExpires = new Date(
        Date.now() + RESERVATION_HOURS * 60 * 60 * 1000,
      );

      const createdOrder = await tx.order.create({
        data: {
          uuid: orderUuid,
          user_id: dbUser.id,
          status: "PENDING",
          payment_status: "PENDING",
          reservation_expires_at: reservationExpires,
          shipping_carrier: data.shipping_carrier,
          shipping_method: data.shipping_method,
          shipping_cost: data.shipping_cost,
          shipping_original: data.shipping_original,
          shipping_delivery_days: data.shipping_delivery_days,
          shipping_service_id: data.shipping_option_id,
          subtotal,
          total,
        },
      });

      // Create OrderItems (snapshot product name, price, quantity)
      await tx.orderItem.createMany({
        data: cart.items.map((item) => ({
          order_id: createdOrder.id,
          product_id: item.product_id,
          product_name: item.product_name,
          img_product: item.img_product,
          quantity: item.quantity ?? 0,
          unit_price: item.unit_price,
          total_price: item.total_price,
        })),
      });

      // Create OrderShipping from address fields
      await tx.orderShipping.create({
        data: {
          order_id: createdOrder.id,
          recipient_name: data.recipient_name,
          recipient_document: data.recipient_document,
          recipient_phone: data.recipient_phone,
          recipient_email: data.recipient_email,
          street: data.street,
          number: data.number,
          complement: data.complement ?? null,
          neighborhood: data.neighborhood,
          city: data.city,
          state: data.state,
          postal_code: data.postal_code,
        },
      });

      // Increment Product.reserved_stock per item
      for (const item of cart.items) {
        const itemQty = item.quantity ?? 0;
        await tx.product.update({
          where: { id: item.product_id },
          data: {
            reserved_stock: {
              increment: itemQty,
            },
          },
        });
      }

      // Close the cart (atomic — inside the same transaction)
      await tx.cart.update({
        where: { id: cart.id },
        data: { status: "closed" },
      });

      return createdOrder;
    });

    const response: CheckoutResponse = {
      redirect: `/checkout/${order.uuid}`,
      expires_in_seconds: RESERVATION_SECONDS,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.status === 401) {
        return NextResponse.json(
          { error: err.message, code: err.code, retryable: false },
          { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
        );
      }
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: false },
        { status: err.status },
      );
    }

    // Stock validation errors thrown from inside the transaction
    if (err instanceof Error && err.message.includes("Estoque insuficiente")) {
      return NextResponse.json(
        { error: err.message, code: "INSUFFICIENT_STOCK", retryable: false },
        { status: 400 },
      );
    }

    // Product deleted between cart load and checkout → meaningful 400
    if (err instanceof Error && err.message.includes("Produto não encontrado")) {
      return NextResponse.json(
        { error: err.message, code: "PRODUCT_NOT_FOUND", retryable: false },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
      { status: 500 },
    );
  }
}
