// OrdersTable contract tests (Plan 30-04, Task 1).
//
// Parity targets (SPA Frontend/src/Pages/User/Orders/OrdersPage.tsx +
// 30-CONTEXT D-01..D-06):
//   - columns PEDIDO / DATA (explicit dd/mm/yyyy) / STATUS (canonical badge
//     labels from OrdersStatusBadge STATUS_CONFIG — SPA parity) / ITENS
//     (first name + "+N") / TOTAL (BRL) / AÇÕES
//   - D-01 pagination client-side, 5/page default, selector 5/10/20
//   - whole-row click + "Ver detalhes" → /pedidos/[id] (30-07 anchor)
//   - D-06 refund button is inert (aria-disabled, no onClick) — reimbursement
//     only after support analysis
//   - loading skeletons, empty state with CTA to /loja, error + retry

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { OrdersTable } from "./OrdersTable";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// JSX inside vi.mock factories breaks under `jsx: preserve` — use
// React.createElement with a lazy require instead (hoisted factory cannot
// reference the module-scope React binding).
vi.mock("next/link", () => {
  const React = require("react") as typeof import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
  };
});

const fetchMock = vi.fn<typeof fetch>();

// ─── fixtures ────────────────────────────────────────────────────────────────

// created_at at 12:00 UTC → same calendar day in America/Sao_Paulo (UTC-3):
// "17/09/2026" keeps the pinned dd/mm/yyyy assertion stable.
type OrderWire = {
  id: string;
  short_id: string;
  status: string | null;
  total: number | null;
  created_at: string | null;
  items: { name: string; qty: number; price: number }[];
  payment_method: string | null;
};

function makeOrder(over: Partial<OrderWire> & { id: string }): OrderWire {
  return {
    short_id: `P-${over.id.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
    status: "CONFIRMED",
    total: 129.9,
    created_at: "2026-09-17T12:00:00.000Z",
    items: [{ name: "Baralho Clássico", qty: 1, price: 129.9 }],
    payment_method: "pix",
    ...over,
  };
}

const ORDER_1 = makeOrder({ id: "11111111-aaaa-4b6c-9f8d-111111111111" });
const SIX_ORDERS = Array.from({ length: 6 }, (_, i) =>
  makeOrder({
    id: `${i + 1}${"0".repeat(11)}-aaaa-4b6c-9f8d-${String(i + 1).padStart(12, "0")}`,
  }),
);

function respond(orders: OrderWire[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ orders }),
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  pushMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── tests ───────────────────────────────────────────────────────────────────

describe("OrdersTable", () => {
  it("renders SPA-parity cells for a single order", async () => {
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    expect(await screen.findByText("P-11111")).toBeInTheDocument();
    // explicit dd/mm/yyyy (no toLocaleDateString drift)
    expect(screen.getByText("17/09/2026")).toBeInTheDocument();
    // canonical badge label for CONFIRMED → "Pago" (SPA STATUS_CONFIG parity)
    expect(screen.getByText("Pago")).toBeInTheDocument();
    // single item → name only (no "+N")
    expect(screen.getByText("Baralho Clássico")).toBeInTheDocument();
    // BRL locale
    expect(screen.getByText("R$ 129,90")).toBeInTheDocument();
  });

  it("summarizes multiple items as first name +N", async () => {
    respond([
      makeOrder({
        id: "22222222-aaaa-4b6c-9f8d-222222222222",
        items: [
          { name: "Kit Iniciante", qty: 1, price: 89.9 },
          { name: "Baralho Clássico", qty: 1, price: 40.0 },
          { name: "Dado Poliédrico", qty: 1, price: 15.5 },
        ],
      }),
    ]);
    render(<OrdersTable userId={7} />);

    expect(await screen.findByText(/Kit Iniciante \+2/)).toBeInTheDocument();
  });

  it("shows empty state with CTA to /loja", async () => {
    respond([]);
    render(<OrdersTable userId={7} />);

    expect(await screen.findByText("Você ainda não tem pedidos")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explorar loja" })).toHaveAttribute("href", "/loja");
  });

  it("shows error state and retries on failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    expect(await screen.findByText("Não foi possível carregar seus pedidos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(await screen.findByText("P-11111")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/orders/list", expect.any(Object));
  });

  it("never sends a user id to filter by (T-30-04-01)", async () => {
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    await screen.findByText("P-11111");
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe("/api/orders/list");
    expect(String(init?.body ?? "")).not.toContain("7");
    expect(JSON.stringify(init)).not.toContain("userId");
    // the session id appears only as a debug attribute on the container
    expect(screen.getByTestId("orders-table")).toHaveAttribute("data-user-id", "7");
  });

  it("paginates at 5/page by default with page 1 of 2", async () => {
    respond(SIX_ORDERS);
    render(<OrdersTable userId={7} />);

    await screen.findByText("P-10000");
    expect(screen.getAllByText(/^P-\d{5}$/)).toHaveLength(5);
    expect(screen.getByText(/PÁGINA 1 DE 2/)).toBeInTheDocument();
  });

  it("advances to page 2 and honors the page-size selector", async () => {
    respond(SIX_ORDERS);
    render(<OrdersTable userId={7} />);
    const user = userEvent.setup();

    await screen.findByText("P-10000");
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }));

    expect(await screen.findByText("P-60000")).toBeInTheDocument();
    expect(screen.getAllByText(/^P-\d{5}$/)).toHaveLength(1);
    expect(screen.getByText(/PÁGINA 2 DE 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Itens por página" }), "10");
    expect(screen.getAllByText(/^P-\d{5}$/)).toHaveLength(6);
    expect(screen.getByText(/PÁGINA 1 DE 1/)).toBeInTheDocument();
  });

  it("navigates to /pedidos/[id] on whole-row click", async () => {
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    const row = (await screen.findByText("P-11111")).closest('[role="link"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(pushMock).toHaveBeenCalledWith(`/pedidos/${ORDER_1.id}`);
  });

  it("renders a real Ver detalhes link to /pedidos/[id]", async () => {
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    const link = await screen.findByRole("link", { name: "Ver detalhes" });
    expect(link).toHaveAttribute("href", `/pedidos/${ORDER_1.id}`);
  });

  it("refund button is inert (D-06)", async () => {
    respond([ORDER_1]);
    render(<OrdersTable userId={7} />);

    const refund = await screen.findByRole("button", { name: /Solicitar Devolução/ });
    expect(refund).toHaveAttribute("aria-disabled", "true");
    expect(refund).toHaveAttribute("title");
    fireEvent.click(refund);
    expect(pushMock).not.toHaveBeenCalled();
  });
});