// Shared order contract for the payment panels (Plans 29-05/29-06).
//
// OrderConfirmation.tsx serializes the Phase 28 `SerializedOrder` and passes
// it to PaymentTabs unchanged (contract note: "keep order props shape — do NOT
// rename"). This module declares the structural SUBSET the panels consume, so
// the mount stays assignable and the panels stay decoupled from
// OrderConfirmation.tsx (no import cycle).

export type OrderConfirmationData = {
  uuid: string;
  total: number | null;
  payment_status: string | null;
  /** Cardholder CPF for in-browser tokenization (D-20 holderDocument). */
  shipping: { recipient_document: string | null } | null;
};