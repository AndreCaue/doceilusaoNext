// POST /api/payment/card/installments — brand + total (reais) → options (D-22).
//
// Plan 29-05 App Router surfacing over getCardInstallments (29-03):
//   body { brand, total } → { installments: [{ installment, installment_value,
//   total_value, interest_percentage, has_interest }] }  (reais numbers —
//   service.py:604-612 parity; frontend formats with toFixed(2)).
//
// PUBLIC endpoint (D-22): the estimator is market-rate info, not user data —
// parity Frontend CardPayment.tsx calls it with no session either.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getCardInstallments } from "@/lib/payments/card";
import { invalidRequestResponse, paymentErrorResponse } from "@/lib/payments/route-helpers";

const BRANDS = ["visa", "mastercard", "elo", "amex", "hipercard"] as const;

const bodySchema = z.object({
  brand: z.enum(BRANDS),
  total: z.number().positive(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return invalidRequestResponse();

    const { brand, total } = parsed.data;
    // reais → cents (D-06 zero-float-drift; int() math stays in the lib).
    const result = await getCardInstallments(brand, Math.round(total * 100));

    return NextResponse.json({ installments: result.installments });
  } catch (err) {
    return paymentErrorResponse(err);
  }
}