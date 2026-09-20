"use client";

// Payment collection tabs (Plan 29-05) — parity Frontend PixPayment +
// CardPayment on the successor UI-SPEC. Mounted on OrderConfirmation in place
// of the Phase 28 placeholder; ReservationCountdown renders ABOVE this
// component (OrderConfirmation — Phase 28 parity), so there is no second
// countdown here (29-05 task 2 note).
//
// Tabs: "pix" | "card" (D-15 / D-20 / D-22). A PAID order (page refresh after
// confirmation) never re-exposes the payment forms — double-charge guard.

import React from "react";
import { useState } from "react";
import type { JSX } from "react";
import { CheckCircle2, CreditCard, QrCode } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { PixPanel } from "./PixPanel";
import { CardPanel } from "./CardPanel";
import type { OrderConfirmationData } from "./types";

type PaymentMethod = "pix" | "card";

export function PaymentTabs({
  order,
}: {
  order: OrderConfirmationData;
}): JSX.Element {
  const [method, setMethod] = useState<PaymentMethod>("pix");

  // PAY-04/PAY-05 — already-paid orders show a confirmation surface, never the
  // payment forms again (re-parse after router.refresh() on PAID).
  if (order.payment_status === "PAID") {
    return (
      <div className="rounded-xl border border-slate-800 bg-neutral-900/40 backdrop-blur p-6 text-center space-y-2">
        <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400" />
        <p className="font-medium text-slate-200">Pagamento confirmado</p>
        <p className="text-sm text-muted-foreground">
          Seu pedido está sendo processado.
        </p>
        <Toaster position="bottom-right" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-neutral-900/40 backdrop-blur p-4 sm:p-6">
      <Toaster position="bottom-right" />
      <Tabs
        value={method}
        onValueChange={(value) => setMethod(value as PaymentMethod)}
        className="w-full"
      >
        <TabsList className="grid w-full h-11 grid-cols-2">
          <TabsTrigger value="pix" className="gap-2">
            <QrCode className="size-4" />
            PIX
          </TabsTrigger>
          <TabsTrigger value="card" className="gap-2">
            <CreditCard className="size-4" />
            Cartão de crédito
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pix" className="mt-5">
          {method === "pix" && <PixPanel order={order} />}
        </TabsContent>
        <TabsContent value="card" className="mt-5">
          {method === "card" && <CardPanel order={order} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
