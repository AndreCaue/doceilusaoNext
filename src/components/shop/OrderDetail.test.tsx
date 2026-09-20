// OrderDetail contract tests (Plan 30-07, Task 1 — RED).
//
// Rendering contract for the deep-linkable order detail page surface (ORDER-03):
//   - header: short id (P-XXXXX) + canonical OrdersStatusBadge (STATUS_CONFIG
//     SPA parity) + total BRL + created_at dd/mm/yyyy
//   - items: product name, quantity x unit price, line total BRL, thumbnail
//     img when img_product set, muted placeholder when null
//   - totals block: subtotal / freight / discount (0 → hidden) / total
//   - shipping block: full address + recipient contact; muted "Sem endereço"
//     when shipping_full is null
//   - payment block: method label + payment status labels (PAID → "Pago",
//     REFUNDED → "Estornado", PENDING → "Aguardando pagamento")
//   - tracking block (D-04): read-only info when tracking present; read-only
//     timeline section gated on shipped/delivered sentinels; muted
//     "Sem informações de rastreio" + no timeline when tracking is null
//   - expired state: PENDING + expired → amber warning banner, NO countdown;
//     PENDING + not expired → ReservationCountdown on expires_at
//
// ReservationCountdown is mocked as a passthrough stub (Phase 28 component) —
// the test stays focused on OrderDetail's own branches. next/image is a plain
// <img> factory (jsdom cannot render the real client component).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OrderDetail } from "./OrderDetail";

// Explicit cleanup — guarantee no DOM bleed between it() blocks (the header
// total and the totals-block total are the same string in the SAME render, so
// cross-test bleed would make strict getByText assertions ambiguous).
afterEach(cleanup);

// JSX inside vi.mock factories breaks under `jsx: preserve` — use
// React.createElement with a lazy require instead (hoisted factory cannot
// reference the module-scope React binding).
vi.mock("next/image", () => {
  const React = require("react") as typeof import("react");
  return {
    // drop next/image-only props (unoptimized/fill) — they are not valid img
    // attributes and would trigger React unknown-attribute warnings
    default: ({
      src,
      alt,
      unoptimized: _unoptimized,
      fill: _fill,
      ...rest
    }: {
      src: string;
      alt?: string;
      unoptimized?: boolean;
      fill?: boolean;
    }) =>
      React.createElement("img", { src, alt, ...rest }),
  };
});

vi.mock("next/link", () => {
  const React = require("react") as typeof import("react");
  return {
    default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
      React.createElement("a", { href, ...rest }, children),
  };
});

vi.mock("./ReservationCountdown", () => {
  const React = require("react") as typeof import("react");
  return {
    ReservationCountdown: ({ expiresAt }: { expiresAt: string | null }) =>
      React.createElement(
        "div",
        { "data-testid": "reservation-countdown" },
        expiresAt ?? "null",
      ),
  };
});

// ─── fixtures ────────────────────────────────────────────────────────────────
// Local mirror of the serialized order shape the page hands the client
// component (ISO date strings; no Date objects cross the boundary).
// created_at 12:00 UTC / status_updated_at 14:00 UTC → same calendar day in
// America/Sao_Paulo (UTC-3) — keeps pinned dd/mm/yyyy stable ("17/09/2026").

type TrackingFixture = {
  tracking_code: string | null;
  tracking_url: string | null;
  shipping_company: string | null;
  shipping_status: string | null;
  status_label: string | null;
  status_updated_at: string | null;
};

type OrderFixture = {
  id: string;
  uuid: string;
  status: string | null;
  payment_status: string | null;
  subtotal: number | null;
  shipping_method: string;
  shipping_carrier: string;
  shipping_cost: number;
  shipping_discount: number;
  shipping_original: number;
  shipping_delivery_days: number;
  expires_at: number | null;
  total: number | null;
  user: { recipient_name: string; recipient_document: string } | null;
  items: {
    product_id: number;
    quantity: number;
    unit_price: number;
    total_price: number;
    img_product: string | null;
    product_name: string;
  }[];
  payment_method: string | null;
  paid_at: string | null;
  created_at: string | null;
  shipping_full: {
    recipient_name: string;
    recipient_document: string;
    recipient_phone: string;
    recipient_email: string;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
    postal_code: string;
  } | null;
  tracking: TrackingFixture | null;
  expired: boolean;
};

function makeOrder(over: Partial<OrderFixture> & { id: string }): OrderFixture {
  return {
    uuid: `P-${over.id.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
    status: "DELIVERED",
    payment_status: "PAID",
    subtotal: 160.9,
    shipping_method: "PAC",
    shipping_carrier: "Correios",
    shipping_cost: 29.9,
    shipping_discount: 0,
    shipping_original: 29.9,
    shipping_delivery_days: 7,
    expires_at: null,
    total: 190.8,
    user: { recipient_name: "Maria Silva", recipient_document: "123.456.789-00" },
    items: [
      {
        product_id: 1,
        quantity: 1,
        unit_price: 129.9,
        total_price: 129.9,
        img_product: "https://cdn.example.com/baralho.jpg",
        product_name: "Baralho Clássico",
      },
      {
        product_id: 2,
        quantity: 2,
        unit_price: 15.5,
        total_price: 31.0,
        img_product: null,
        product_name: "Dado Poliédrico",
      },
    ],
    payment_method: "credit_card",
    paid_at: "2026-09-17T13:00:00.000Z",
    created_at: "2026-09-17T12:00:00.000Z",
    shipping_full: {
      recipient_name: "Maria Silva",
      recipient_document: "123.456.789-00",
      recipient_phone: "(11) 99999-8888",
      recipient_email: "maria@example.com",
      street: "Rua das Flores",
      number: "123",
      complement: "Apto 45",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      postal_code: "01310100",
    },
    tracking: {
      tracking_code: "BR123456789BR",
      tracking_url: "https://www2.correios.com.br/sistemas/rastreamento/?P=BR123456789BR",
      shipping_company: "Correios",
      shipping_status: "delivered",
      status_label: "Entregue",
      status_updated_at: "2026-09-17T14:00:00.000Z",
    },
    expired: false,
    ...over,
  };
}

const ORDER = makeOrder({ id: "11111111-aaaa-4b6c-9f8d-111111111111" });

// ─── tests ───────────────────────────────────────────────────────────────────

describe("OrderDetail", () => {
  it("renders the header: short id, badge label, BRL total and dd/mm/yyyy date", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("P-11111")).toBeInTheDocument();
    // canonical STATUS_CONFIG label for DELIVERED (SPA parity from 30-04)
    expect(screen.getAllByText("Entregue").length).toBeGreaterThan(0);
    // total appears in the header AND the totals block
    expect(screen.getAllByText("R$ 190,80").length).toBeGreaterThan(0);
    expect(screen.getByText("17/09/2026")).toBeInTheDocument();
  });

  it("renders each item: name, quantity x unit price and line total", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("Baralho Clássico")).toBeInTheDocument();
    expect(screen.getByText("Dado Poliédrico")).toBeInTheDocument();
    expect(screen.getByText("1x R$ 129,90")).toBeInTheDocument();
    expect(screen.getByText("2x R$ 15,50")).toBeInTheDocument();
    // line totals (own span — "1x R$ 129,90" is a separate element)
    expect(screen.getByText("R$ 129,90")).toBeInTheDocument();
    expect(screen.getByText("R$ 31,00")).toBeInTheDocument();
  });

  it("renders item thumbnails: img src when img_product set, muted placeholder when null", () => {
    render(<OrderDetail order={ORDER} />);

    const img = screen.getByAltText("Baralho Clássico");
    expect(img).toHaveAttribute("src", "https://cdn.example.com/baralho.jpg");
    // only the null-img item renders the placeholder
    expect(screen.getAllByTestId("item-no-image")).toHaveLength(1);
  });

  it("renders the totals block: subtotal, freight, total; discount hidden when 0", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("R$ 160,90")).toBeInTheDocument(); // subtotal
    expect(screen.getByText("R$ 29,90")).toBeInTheDocument(); // freight
    expect(screen.queryByText(/Desconto no frete/)).not.toBeInTheDocument();
    expect(screen.getAllByText("R$ 190,80").length).toBeGreaterThan(0); // total
  });

  it("shows the freight discount row when shipping_discount is non-zero", () => {
    render(
      <OrderDetail
        order={makeOrder({
          id: "22222222-aaaa-4b6c-9f8d-222222222222",
          shipping_discount: 5.9,
          total: 184.9,
        })}
      />,
    );

    expect(screen.getByText(/Desconto no frete/)).toBeInTheDocument();
    // total surfaces in both the header and the totals block
    expect(screen.getAllByText("R$ 184,90").length).toBeGreaterThan(0);
  });

  it("renders the full shipping address and recipient contact", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("123.456.789-00")).toBeInTheDocument();
    expect(screen.getByText("Rua das Flores, 123 — Apto 45")).toBeInTheDocument();
    expect(screen.getByText("Centro")).toBeInTheDocument();
    expect(screen.getByText("São Paulo — SP")).toBeInTheDocument();
    expect(screen.getByText("CEP: 01310-100")).toBeInTheDocument(); // CEP formatted
    expect(screen.getByText("(11) 99999-8888")).toBeInTheDocument();
    expect(screen.getByText("maria@example.com")).toBeInTheDocument();
  });

  it("omits complement when null and renders a muted block when shipping_full is null", () => {
    render(
      <OrderDetail
        order={makeOrder({
          id: "33333333-aaaa-4b6c-9f8d-333333333333",
          shipping_full: {
            ...(ORDER.shipping_full as NonNullable<OrderFixture["shipping_full"]>),
            complement: null,
          },
        })}
      />,
    );
    expect(screen.getByText("Rua das Flores, 123")).toBeInTheDocument();
    expect(screen.queryByText(/Apto 45/)).not.toBeInTheDocument();

    render(
      <OrderDetail
        order={makeOrder({ id: "44444444-aaaa-4b6c-9f8d-444444444444", shipping_full: null })}
      />,
    );
    expect(screen.getByText("Sem endereço")).toBeInTheDocument();
  });

  it("renders the payment block: method label and payment status PAID → Pago", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("Cartão de crédito")).toBeInTheDocument();
    expect(screen.getByText("Pago")).toBeInTheDocument();
  });

  it("maps payment status REFUNDED → Estornado", () => {
    render(
      <OrderDetail
        order={makeOrder({ id: "55555555-aaaa-4b6c-9f8d-555555555555", payment_status: "REFUNDED" })}
      />,
    );

    expect(screen.getByText("Estornado")).toBeInTheDocument();
  });

  it("renders the tracking block with code, carrier link and timeline when tracking is present", () => {
    render(<OrderDetail order={ORDER} />);

    expect(screen.getByText("BR123456789BR")).toBeInTheDocument();
    expect(screen.getByText("Correios")).toBeInTheDocument();
    const trackLink = screen.getByRole("link", { name: "Acompanhar entrega" });
    expect(trackLink).toHaveAttribute(
      "href",
      "https://www2.correios.com.br/sistemas/rastreamento/?P=BR123456789BR",
    );
    expect(trackLink).toHaveAttribute("target", "_blank");
    expect(trackLink).toHaveAttribute("rel", "noopener noreferrer");
    // status_label + status_updated_at formatted inside the read-only timeline
    // (shipping_status "delivered" is a sentinel → timeline section rendered)
    expect(screen.getByText("Entregue — 17/09/2026")).toBeInTheDocument();
    expect(screen.getByTestId("tracking-timeline")).toBeInTheDocument();
  });

  it("gates the timeline on shipped/delivered sentinels and renders a muted block when tracking is null", () => {
    // sentinel NOT reached (e.g. "posted"): status line, no timeline
    render(
      <OrderDetail
        order={makeOrder({
          id: "66666666-aaaa-4b6c-9f8d-666666666666",
          tracking: {
            tracking_code: "BR111222333BR",
            tracking_url: null,
            shipping_company: "Correios",
            shipping_status: "posted",
            status_label: "Postado",
            status_updated_at: "2026-09-17T14:00:00.000Z",
          },
        })}
      />,
    );
    expect(screen.getByText(/Status: Postado/)).toBeInTheDocument();
    expect(screen.queryByTestId("tracking-timeline")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acompanhar entrega" })).not.toBeInTheDocument();

    // tracking null (D-04 render gating): muted copy, no timeline, no link
    render(
      <OrderDetail
        order={makeOrder({ id: "77777777-aaaa-4b6c-9f8d-777777777777", tracking: null })}
      />,
    );
    expect(screen.getByText("Sem informações de rastreio")).toBeInTheDocument();
    expect(screen.queryByTestId("tracking-timeline")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acompanhar entrega" })).not.toBeInTheDocument();
  });

  it("renders the expired banner instead of the countdown for expired PENDING orders", () => {
    render(
      <OrderDetail
        order={makeOrder({ id: "88888888-aaaa-4b6c-9f8d-888888888888", status: "PENDING", expired: true, expires_at: 0 })}
      />,
    );

    expect(
      screen.getByText("Este pedido venceu por falta de pagamento"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("reservation-countdown")).not.toBeInTheDocument();
  });

  it("renders the ReservationCountdown for PENDING orders that are not expired", () => {
    render(
      <OrderDetail
        order={makeOrder({ id: "99999999-aaaa-4b6c-9f8d-999999999999", status: "PENDING", expired: false, expires_at: 7200 })}
      />,
    );

    expect(screen.getByTestId("reservation-countdown")).toBeInTheDocument();
    expect(
      screen.queryByText("Este pedido venceu por falta de pagamento"),
    ).not.toBeInTheDocument();
  });
});