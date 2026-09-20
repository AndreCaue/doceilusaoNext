// Canonical order-status pill (Plan 30-04, Task 1).
//
// Single source of truth for order status → (PT-BR label, pill colors).
// Keys are the Prisma OrderStatus enum values as returned by the client
// (UPPERCASE: "PENDING", "CONFIRMED", ...) — see prisma/schema.prisma
// `enum OrderStatus`. Labels mirror the SPA's STATUS_CONFIG in
// Frontend/src/Pages/User/Orders/componentes.tsx exactly (PT-BR parity).
//
// Consumed by: OrdersTable (/pedidos, 30-04) and the order detail page
// consumed by 30-07 — divergence between the two is impossible by construction.
// Dependency-free on purpose (no TanStack import → usable from Server Components).

type StatusConfig = {
  label: string;
  color: string; // tailwind pill classes: text-X bg-X/10 (border uses white/10)
};

/** Prisma UPPERCASE enum value → SPA-parity label + colors. */
export const STATUS_CONFIG: Record<string, StatusConfig> = {
  PENDING: { label: "Pendente", color: "text-amber-400 bg-amber-400/10" },
  CONFIRMED: { label: "Pago", color: "text-emerald-400 bg-emerald-400/10" },
  PROCESSING: { label: "Preparação para envio", color: "text-blue-400 bg-blue-400/10" },
  SHIPPED: { label: "Em trânsito", color: "text-sky-400 bg-sky-400/10" },
  DELIVERED: { label: "Entregue", color: "text-emerald-400 bg-emerald-400/10" },
  CANCELED: { label: "Cancelado", color: "text-red-400 bg-red-400/10" },
  PAYMENT_FAILED: { label: "Falhou", color: "text-rose-400 bg-rose-400/10" },
  REFUNDED: { label: "Estornado", color: "text-violet-400 bg-violet-400/10" },
  // No SPA STATUS_CONFIG key exists for these two — neutral canonical labels
  // (never claim SPA parity for statuses the SPA cannot reach).
  RETURNED: { label: "Devolvido", color: "text-gray-400 bg-gray-400/10" },
  DISPUTED: { label: "Disputa", color: "text-gray-400 bg-gray-400/10" },
};

const NEUTRAL: StatusConfig = { label: "—", color: "text-gray-400 bg-gray-400/10" };

export function OrdersStatusBadge({ status }: { status: string | null }) {
  const cfg = status ? (STATUS_CONFIG[status] ?? NEUTRAL) : NEUTRAL;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 font-mono text-[11px] font-medium tracking-wide ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}