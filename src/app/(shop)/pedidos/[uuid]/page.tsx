// Order detail page — Server Component shell (Plan 30-07, ORDER-03).
// Deep-linkable at /pedidos/[uuid] (the 30-04 history table anchors here).
//
// IOR protection is owned by getOrderDetailForUser (owner-scoped query):
//   - unknown uuid      → not_found  → notFound()            (404)
//   - another user's    → forbidden  → inline 403 message    (D-07: 403 ≠ 404)
//   - owned             → ok         → serialize Date → ISO and render.
//
// Session gate reuses the same cookie-shim pattern as checkout/[uuid]/page.tsx
// and pedidos/page.tsx (getCurrentUserOptional never throws; guests → login).

import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserOptional } from "@/lib/auth/guards";
import { getOrderDetailForUser, type OrderDetailOrder } from "@/lib/orders/queries";
import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import {
  OrderDetail,
  type SerializedOrderDetail,
} from "@/components/shop/OrderDetail";

type PageProps = {
  params: Promise<{ uuid: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { uuid } = await params;
  // Short-id derivation mirrors queries.shortId() — no re-query needed.
  return { title: `Pedido P-${uuid.slice(0, 5).toUpperCase()}` };
}

/** Strip Prisma Date objects → ISO strings (nothing non-serializable crosses
 *  the Server→Client boundary). */
function serialize(order: OrderDetailOrder): SerializedOrderDetail {
  return {
    ...order,
    created_at: order.created_at?.toISOString() ?? null,
    paid_at: order.paid_at?.toISOString() ?? null,
    tracking: order.tracking
      ? {
          ...order.tracking,
          status_updated_at: order.tracking.status_updated_at?.toISOString() ?? null,
        }
      : null,
  };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { uuid } = await params;

  // Auth gate — cookie-based request shim (parity with checkout/[uuid]/page.tsx).
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
    redirect(`/login?redirect=/pedidos/${uuid}`);
  }

  // Resolve numeric user id for the owner-scoped detail read
  const dbUser = await prisma.user.findUnique({
    where: { uuid: identity.uuid },
    select: { id: true },
  });
  if (!dbUser) {
    notFound();
  }

  const result = await getOrderDetailForUser(uuid, dbUser.id);
  if (result.kind === "not_found") {
    notFound(); // unknown uuid → 404
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 py-30 max-w-3xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Detalhes do pedido"
          subTitle="Revise o andamento do seu pedido"
        />

        {result.kind === "forbidden" ? (
          // D-07: other user's order — inline 403, zero order data leaks.
          <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-4">
            <p className="text-sm text-red-300">
              Você não tem permissão para ver este pedido
            </p>
          </div>
        ) : (
          <OrderDetail order={serialize(result.order)} />
        )}
      </div>
    </div>
  );
}