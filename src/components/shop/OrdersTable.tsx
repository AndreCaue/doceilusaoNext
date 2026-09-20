"use client";

// "Meus Pedidos" history table (Plan 30-04, Task 1).
//
// SPA-parity order history (ORDER-01): client component that fetches
// GET /api/orders/list (the 30-03 endpoint that never 5xxes) on mount and
// renders an @tanstack/react-table with:
//   - D-01 client pagination: page size 5 default, selector 5/10/20
//   - columns PEDIDO / DATA (explicit dd/mm/yyyy) / STATUS (OrdersStatusBadge)
//     / ITENS (first name + "+N") / TOTAL (BRL) / AÇÕES
//   - whole-row click + "Ver detalhes" link → /pedidos/[id] (30-07 anchor)
//   - inert "Solicitar Devolução" button (D-06: refunds go through support —
//     no client-side action)
//   - loading skeletons, empty state with CTA to /loja, error state with retry
//
// The row type is a LOCAL mirror of the /api/orders/list wire shape — the
// client never imports prisma-bound server types (next/prisma cannot be
// bundled into a client component).

import React from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Package, RefreshCcw } from "lucide-react";
import { OrdersStatusBadge } from "./OrdersStatusBadge";

// Wire shape of GET /api/orders/list → { orders: OrderListItem[] } (30-03 contract).
// created_at arrives as an ISO string (NextResponse.json serialization).
type OrderListItem = {
  id: string;
  short_id: string;
  status: string | null;
  total: number | null;
  created_at: string | null;
  items: { name: string; qty: number; price: number }[];
  payment_method: string | null;
};

const PAGE_SIZES = [5, 10, 20] as const;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Explicit dd/mm/yyyy — no toLocaleDateString (intl-dependent output would
 *  drift across ICU versions). Null/NaN → "—". */
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function itemsSummary(items: OrderListItem["items"]): string {
  if (items.length === 0) return "—";
  const first = items[0].name;
  return items.length > 1 ? `${first} +${items.length - 1}` : first;
}

export function OrdersTable({ userId }: { userId: number }) {
  const router = useRouter();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch on mount (client-side, like the SPA's OrdersPage effect). The route
  // resolves the session server-side — this client NEVER sends a user id to
  // filter by (T-30-04-01).
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch("/api/orders/list", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { orders?: OrderListItem[] };
        if (!cancelled)
          setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const columns = useMemo<ColumnDef<OrderListItem>[]>(
    () => [
      {
        id: "short_id",
        accessorFn: (row) => row.short_id,
        header: "PEDIDO",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-white/80">
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: "created_at",
        accessorFn: (row) => row.created_at,
        header: "DATA",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-white/40">
            {formatDate(getValue<string | null>())}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "STATUS",
        cell: ({ getValue }) => (
          <OrdersStatusBadge status={getValue<string | null>()} />
        ),
      },
      {
        id: "items",
        accessorFn: (row) => row.items,
        header: "ITENS",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-white/40">
            {itemsSummary(getValue<OrderListItem["items"]>())}
          </span>
        ),
      },
      {
        id: "total",
        accessorFn: (row) => row.total,
        header: "TOTAL",
        cell: ({ getValue }) => {
          const total = getValue<number | null>();
          return (
            <span className="font-mono text-sm font-medium text-white/90">
              {total == null ? "—" : brl.format(total)}
            </span>
          );
        },
      },
    ],
    [],
  );

  const table = useReactTable({
    data: orders,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZES[0] } },
  });

  const gridCols = "grid-cols-[1.5fr_1.2fr_1.6fr_2fr_1.2fr_1.6fr]";

  if (loading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`${gridCols} grid gap-4 border-b border-white/[0.06] px-6 py-4 last:border-b-0`}
          >
            {[24, 32, 28, 40, 32].map((w, j) => (
              <div
                key={j}
                className="h-4 animate-pulse rounded bg-white/[0.06]"
                style={{ width: `${w * 3}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16">
        <p className="font-mono text-sm text-white/60">
          Não foi possível carregar seus pedidos.
        </p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-white/70 transition-colors hover:bg-white/10"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16">
        <Package size={32} className="text-white/25" />
        <p className="font-mono text-sm text-white/60">
          Você ainda não tem pedidos
        </p>
        <Link
          href="/loja"
          className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-4 py-2 font-mono text-xs text-violet-300 transition-colors hover:bg-violet-400/20"
        >
          Explorar loja
        </Link>
      </div>
    );
  }

  return (
    <div
      data-testid="orders-table"
      data-user-id={userId}
      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
    >
      {/* header */}
      <div
        className={`${gridCols} grid gap-4 border-b border-white/10 bg-white/[0.03] px-6 py-3`}
      >
        {table.getHeaderGroups().map((headerGroup) =>
          headerGroup.headers.map((header) => (
            <div
              key={header.id}
              className="font-mono text-[10px] tracking-[0.2em] text-white/35"
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          )),
        )}
        <div className="font-mono text-[10px] tracking-[0.2em] text-white/35">
          AÇÕES
        </div>
      </div>

      {/* rows */}
      {table.getRowModel().rows.map((row) => {
        const order = row.original;
        return (
          <div
            key={order.id}
            role="link"
            tabIndex={0}
            onClick={() => router.push(`/pedidos/${order.id}`)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                router.push(`/pedidos/${order.id}`);
              }
            }}
            className={`${gridCols} grid cursor-pointer gap-4 border-b border-white/[0.06] px-6 py-4 transition-colors last:border-b-0 hover:bg-white/[0.04]`}
          >
            {row.getVisibleCells().map((cell) => (
              <div key={cell.id} className="flex items-center">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Link
                href={`/pedidos/${order.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-xs text-violet-300 transition-colors hover:text-violet-200"
              >
                Ver detalhes
              </Link>
              <button
                type="button"
                aria-disabled="true"
                title="Solicitação de Reembolso passa pela análise, somente após aprovação o processo de estorno será iniciado."
                // Defensively inert: pointer-events-none blocks real clicks; the
                // stopPropagation guard also shields the row navigation handler
                // from synthetic/bubbled activation (jsdom tests included).
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-none inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[11px] text-white/40"
              >
                <RefreshCcw size={12} />
                Solicitar Devolução
              </button>
            </div>
          </div>
        );
      })}

      {/* pagination footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.03] px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.2em] text-white/35">
            POR PÁGINA
          </span>
          <select
            aria-label="Itens por página"
            value={table.getState().pagination.pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-white/70 outline-none"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] tracking-[0.2em] text-white/35">
            PÁGINA {table.getState().pagination.pageIndex + 1} DE{" "}
            {table.getPageCount()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Página anterior"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/70 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
