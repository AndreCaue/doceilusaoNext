// Order confirmation page — Server Component (CHECKOUT-01).
// Displays order details after successful checkout: items, shipping, totals,
// reservation countdown, and payment placeholder.
//
// IDOR protection: query filters by uuid AND resolves the authenticated user's
// numeric id — mismatch → notFound().
//
// Note: Server Components have no NextRequest — we build a minimal request shim
// from the cookie store (the same next/headers pattern checkout/page.tsx uses).

import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserOptional } from "@/lib/auth/guards";
import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import {
  OrderConfirmation,
  type SerializedOrder,
} from "@/components/shop/OrderConfirmation";

type PageProps = {
  params: Promise<{ uuid: string }>;
};

export default async function OrderConfirmationPage({ params }: PageProps) {
  const { uuid } = await params;

  // Auth gate — cookie-based request shim (parity with checkout/page.tsx);
  // getCurrentUserOptional never throws, guests redirect to login.
  const store = await cookies();
  const req = {
    headers: new Headers(),
    cookies: {
      get: (name: string) => {
        const v = store.get(name);
        return v ? { name, value: v.value } : undefined;
      },
    },
  } as unknown as NextRequest;

  const identity = await getCurrentUserOptional(req);
  if (!identity) {
    redirect(`/login?redirect=/checkout/${uuid}`);
  }

  // Resolve numeric user id for IDOR check
  const dbUser = await prisma.user.findUnique({
    where: { uuid: identity.uuid },
    select: { id: true },
  });
  if (!dbUser) {
    notFound();
  }

  // Fetch order by uuid with items + shipping
  const order = await prisma.order.findUnique({
    where: { uuid },
    include: {
      items: true,
      shipping: true,
    },
  });

  // IDOR guard — order must belong to the authenticated user
  if (!order || order.user_id !== dbUser.id) {
    notFound();
  }

  // Check if reservation has expired
  const expired =
    order.reservation_expires_at !== null &&
    order.reservation_expires_at < new Date();

  // Serialize order — strip non-serializable fields (Date → ISO string)
  const serialized: SerializedOrder = {
    uuid: order.uuid,
    status: order.status,
    payment_status: order.payment_status,
    reservation_expires_at: order.reservation_expires_at?.toISOString() ?? null,
    subtotal: order.subtotal,
    total: order.total,
    shipping_carrier: order.shipping_carrier,
    shipping_method: order.shipping_method,
    shipping_cost: order.shipping_cost,
    shipping_original: order.shipping_original,
    shipping_delivery_days: order.shipping_delivery_days,
    created_at: order.created_at?.toISOString() ?? null,
    items: order.items.map((item) => ({
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.total_price,
      img_product: item.img_product,
    })),
    shipping: order.shipping
      ? {
          recipient_name: order.shipping.recipient_name,
          recipient_document: order.shipping.recipient_document,
          street: order.shipping.street,
          number: order.shipping.number,
          neighborhood: order.shipping.neighborhood,
          city: order.shipping.city,
          state: order.shipping.state,
          postal_code: order.shipping.postal_code,
        }
      : null,
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 py-30 max-w-3xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Pedido confirmado"
          subTitle="Revise os detalhes do seu pedido"
        />

        <OrderConfirmation order={serialized} expired={expired} />
      </div>
    </div>
  );
}
