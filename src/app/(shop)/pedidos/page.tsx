// "Meus Pedidos" page — Server Component shell (ORDER-01, Plan 30-04).
// Thin wrapper: session gate (same cookie shim as checkout/[uuid]/page.tsx —
// getCurrentUserOptional never throws, guests redirect to login) + numeric
// user id resolution, then delegates rendering to the client OrdersTable,
// which owns the fetch of GET /api/orders/list (30-03 route, never 5xx).
//
// Session id is ONLY used as the table's debugging prop — the table fetches
// without sending any user id (T-30-04-01); the route server-scopes by session.

import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserOptional } from "@/lib/auth/guards";
import { DisplayBackground } from "@/components/shop/DisplayBackground";
import { DisplayHeader } from "@/components/shop/DisplayHeader";
import { OrdersTable } from "@/components/shop/OrdersTable";

export const metadata: Metadata = {
  title: "Meus Pedidos",
};

export default async function PedidosPage() {
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
    redirect("/login?redirect=/pedidos");
  }

  // Resolve numeric user id (the table's prop contract)
  const dbUser = await prisma.user.findUnique({
    where: { uuid: identity.uuid },
    select: { id: true },
  });
  if (!dbUser) {
    notFound();
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-gray-800 via-gray-700 to-gray-800 overflow-hidden">
      <DisplayBackground />

      <div className="relative z-10 py-30 max-w-6xl mx-auto px-4 md:px-6">
        <DisplayHeader
          title="Meus Pedidos"
          subTitle="Acompanhe o histórico das suas compras"
        />

        <OrdersTable userId={dbUser.id} />
      </div>
    </div>
  );
}