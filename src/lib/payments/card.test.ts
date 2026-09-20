// Card one-step payment + installments contract tests (Plan 29-03, TDD RED).
//
// Parity targets (29-CONTEXT D-11, D-12, D-16, D-21, D-22; Python
// `Backend/app/payment/service.py` create_card_one_step (316-462) +
// get_card_installments (575-617); `card-flow.md` MIGRATION notes 342/363/377):
//   - Card family = "cobrancas" (D-06) — POST /v1/charge/card/one-step
//     (VERIFIED card-flow.md:363; NOT the draft's "/v1/charge/one-step").
//   - Body parity service.py:375-401: items[{name, amount, value(INT cents)}],
//     metadata{notification_url (D-11: {NGROK|WEBHOOK_URL}/payment/webhook/
//     efipay?webhook_token=...), custom_id=order_{uuid}},
//     payment.credit_card{payment_token, installments, customer{name,email,
//     cpf,phone_number}, billing_address{street,number,neighborhood,zipcode,
//     city,state}}, optional shippings[] when shipping_cost > 0.
//   - D-21 card safety: body carries ONLY the browser `payment_token` — never
//     raw pan/card_number/cvv/card_token keys past the server boundary.
//   - D-16 card parity: status AUTHORIZED/approved/paid → PAID (service.py:433),
//     failed/error/refused → FAILED (service.py:442/536); persistence of
//     efipay_charge_card_id + payment markers on PAID (service.py:430-440).
//   - D-22: installments GET /v1/charge/card/installments?total={cents}&brand=
//     {brand} (VERIFIED card-flow.md:342/377; NOT the draft's
//     "/v1/credit-card/installments/visa"); brand allowlist visa/mastercard/
//     elo/amex/hipercard (service.py:579); options {installment,
//     installment_value, total_value, interest_percentage, has_interest}
//     (service.py:604-612; frontend CardPayment.tsx:160-163 consumes
//     installment_value.toFixed(2) — numbers, not strings).
//   - D-12: non-2xx → EfiError PT-BR — 400 refused card → EFI_INVALID_CARD
//     retryable:false; 429 → EFI_RATE_LIMITED retryable:true (pass-through).
//   - T-25-03: PT-BR errors; never leak payment_token/PAN in error payloads.
//
// NOTE: the plan's "mock @/server/db" target is actually `@/lib/prisma` — the
// real module exporting the `prisma` singleton (src/lib/prisma.ts), per the
// 29-02 precedent. Prisma field names are snake_case (efipay_charge_card_id,
// payment_status, payment_method, paid_at, shipping_cost, ...).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  efiRequestSpy: vi.fn(),
  prisma: {
    order: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/payments/efi-client", () => ({
  efiRequest: mocks.efiRequestSpy,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

// ─── Parity fixtures (the ONLY fields card.ts reads — service.py parity) ─────

const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c";
const CPF = "12345678909";
const BUYER_NAME = "Teste Homologacao";
const PHONE = "(11) 99999-8888";
const PHONE_DIGITS = "11999998888";
const EMAIL = "cliente@example.com";
const GRAND_TOTAL_CENTS = 15990;
const WEBHOOK_SECRET = "segredo-teste";

/** Full order row (Prisma snake_case) as findUnique resolves — service.py:339-373 reads. */
function dbOrderFixture(
  overrides: Partial<{
    shipping_cost: number;
    efipay_charge_card_id: string | null;
    paid_at: Date | null;
    reservation_expires_at: Date | null;
  }> = {},
) {
  return {
    id: 7,
    uuid: ORDER_UUID,
    efipay_charge_card_id: null,
    paid_at: null,
    payment_status: "PENDING",
    shipping_cost: 12.5,
    shipping_carrier: "Correios",
    shipping_method: "PAC",
    shipping: {
      recipient_name: BUYER_NAME,
      recipient_document: CPF,
      recipient_phone: PHONE,
      recipient_email: EMAIL,
      street: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      postal_code: "01310100",
      city: "São Paulo",
      state: "SP",
    },
    items: [{ product_name: "Baralho Mágico", quantity: 2, unit_price: 45.99 }],
    ...overrides,
  };
}

function orderInputFixture() {
  return {
    paymentToken: "tok_abc",
    installments: 3,
    order: {
      uuid: ORDER_UUID,
      grandTotalCents: GRAND_TOTAL_CENTS,
      buyer: { cpf: CPF, name: BUYER_NAME },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv("EFI_SANDBOX", "true");
  vi.stubEnv("NGROK_URL", "https://abc123.ngrok.io");
  vi.stubEnv("WEBHOOK_URL", "https://api.doceilusa.store");
  vi.stubEnv("WEBHOOK_SECRET", WEBHOOK_SECRET);
  // Default DB stubs for the happy path (tests override as needed).
  mocks.prisma.order.findUnique.mockResolvedValue(dbOrderFixture());
  mocks.prisma.order.update.mockResolvedValue({ uuid: ORDER_UUID });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

/** Captured body of the last efiRequest call (the one card.ts made). */
function lastEfiCallBody(): Record<string, unknown> {
  const opts = mocks.efiRequestSpy.mock.calls.at(-1)?.[0] as {
    body?: Record<string, unknown>;
  };
  return opts.body ?? {};
}

describe("createCardOneStep() — one-step body parity (service.py:375-401, D-21)", () => {
  it("calls efiRequest on family cobrancas with the full parity body (POST /v1/charge/card/one-step)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "approved" });
    const { createCardOneStep } = await import("./card");

    await createCardOneStep(orderInputFixture());

    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
    expect(mocks.efiRequestSpy).toHaveBeenCalledWith({
      family: "cobrancas",
      path: "/v1/charge/card/one-step",
      method: "POST",
      body: {
        // service.py:369-373 — item value in INT cents (never a float string)
        items: [{ name: "Baralho Mágico", amount: 2, value: 4599 }],
        // D-11 — notification_url per-charge (per-charge webhook receiver)
        metadata: {
          notification_url: `https://abc123.ngrok.io/payment/webhook/efipay?webhook_token=${WEBHOOK_SECRET}`,
          custom_id: `order_${ORDER_UUID}`,
        },
        payment: {
          credit_card: {
            // D-21 — browser payment_token; raw PAN/cvv NEVER cross the server
            payment_token: "tok_abc",
            installments: 3,
            customer: {
              name: BUYER_NAME,
              email: EMAIL,
              cpf: CPF,
              phone_number: PHONE_DIGITS, // service.py:352-354 — digits only
            },
            // service.py:391-398 — billing_address parity
            billing_address: {
              street: "Rua das Flores",
              number: "123",
              neighborhood: "Centro",
              zipcode: "01310100",
              city: "São Paulo",
              state: "SP",
            },
          },
        },
        // service.py:403-407 — shippings only when shipping_cost > 0
        shippings: [{ name: "Frete - Correios PAC", value: 1250 }],
      },
    });
  });

  it("omits shippings when shipping_cost is 0 (service.py:403)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "approved" });
    mocks.prisma.order.findUnique.mockResolvedValue(dbOrderFixture({ shipping_cost: 0 }));
    const { createCardOneStep } = await import("./card");

    await createCardOneStep(orderInputFixture());

    const body = lastEfiCallBody();
    expect(body).not.toHaveProperty("shippings");
  });

  it("never sends raw card data — no pan|card_number|cvv|card_token keys past the boundary (D-21)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "approved" });
    const { createCardOneStep } = await import("./card");

    await createCardOneStep(orderInputFixture());

    const body = lastEfiCallBody();
    expect(JSON.stringify(body)).not.toMatch(/pan|card_number|cvv|card_token/i);
    // the ONLY card credential that crosses the boundary is the token
    const creditCard = (body.payment as { credit_card: Record<string, unknown> })
      .credit_card;
    expect(creditCard.payment_token).toBe("tok_abc");
    expect(Object.keys(creditCard)).toEqual(["payment_token", "installments", "customer", "billing_address"]);
  });

  it("treats EFI_SANDBOX=\"1\" as SANDBOX (WR-07 — shared config, parity efi-cert.ts): notification_url keeps the ngrok host + webhook token", async () => {
    // Regression: the old strict "==='true'" check silently composed a PROD
    // notification_url (WEBHOOK_URL, token stripped) for sandbox calls.
    vi.stubEnv("EFI_SANDBOX", "1");
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "approved" });
    const { createCardOneStep } = await import("./card");

    await createCardOneStep(orderInputFixture());

    const body = lastEfiCallBody();
    expect((body.metadata as { notification_url: string }).notification_url).toBe(
      `https://abc123.ngrok.io/payment/webhook/efipay?webhook_token=${WEBHOOK_SECRET}`,
    );
  });

  it("uses the PROD WEBHOOK_URL family when EFI_SANDBOX=false (D-11)", async () => {
    vi.stubEnv("EFI_SANDBOX", "false");
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "approved" });
    const { createCardOneStep } = await import("./card");

    await createCardOneStep(orderInputFixture());

    const body = lastEfiCallBody();
    expect((body.metadata as { notification_url: string }).notification_url).toBe(
      `https://api.doceilusa.store/payment/webhook/efipay?webhook_token=${WEBHOOK_SECRET}`,
    );
  });
});

describe("createCardOneStep() — response mapping + persistence (D-16, service.py:430-440)", () => {
  it("maps {charge_id, status AUTHORIZED} → {chargeId, status PAID} and persists card markers", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "AUTHORIZED" });
    const { createCardOneStep } = await import("./card");

    const result = await createCardOneStep(orderInputFixture());

    expect(result).toEqual({
      chargeId: "12345",
      status: "PAID",
      paidAt: expect.any(Date),
    });
    // service.py:430-440 — charge id + payment markers persisted (snake_case)
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { uuid: ORDER_UUID },
      data: {
        efipay_charge_card_id: "12345",
        payment_status: "PAID",
        payment_method: "CREDIT_CARD",
        paid_at: expect.any(Date),
      },
    });
  });

  it.each([
    { efi: "AUTHORIZED", expected: "PAID" }, // one-step authorization vocabulary
    { efi: "approved", expected: "PAID" }, // service.py:433
    { efi: "paid", expected: "PAID" }, // service.py:433
    { efi: "failed", expected: "FAILED" }, // service.py:442
    { efi: "error", expected: "FAILED" }, // service.py:442
    { efi: "refused", expected: "FAILED" }, // webhook parity service.py:536
    { efi: "waiting", expected: "PENDING" }, // webhook parity service.py:560
    { efi: "STATUS_DESCONHECIDO", expected: "PENDING" }, // unknown → non-fatal
  ])("maps Efí status $efi → $expected (D-16 card parity)", async ({ efi, expected }) => {
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: efi });
    const { createCardOneStep } = await import("./card");

    const result = await createCardOneStep(orderInputFixture());

    expect(result.status).toBe(expected);
    if (expected === "PAID") {
      expect(result.paidAt).toBeDefined();
    } else {
      expect(result.paidAt).toBeUndefined();
    }
  });
});

describe("createCardOneStep() — Efí error mapping (D-12)", () => {
  it("maps a 400 refused card to EFI_INVALID_CARD retryable:false with PT-BR message and NO token leak", async () => {
    mocks.efiRequestSpy.mockRejectedValue({
      error: "Requisição inválida à Efí",
      code: "EFI_INVALID_REQUEST",
      retryable: false,
    });
    const { createCardOneStep } = await import("./card");

    const err = await createCardOneStep(orderInputFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect((err as { code?: string }).code).toBe("EFI_INVALID_CARD");
    expect((err as { retryable?: boolean }).retryable).toBe(false);
    expect(typeof (err as { error?: string }).error).toBe("string");
    // T-25-03 — never leak the payment token (or any PAN) in the error payload
    expect(JSON.stringify(err)).not.toContain("tok_abc");
  });

  it("passes through a 429 rate-limit EfiError unchanged (retryable:true)", async () => {
    mocks.efiRequestSpy.mockRejectedValue({
      error: "Limite de requisições à Efí excedido",
      code: "EFI_RATE_LIMITED",
      retryable: true,
    });
    const { createCardOneStep } = await import("./card");

    const err = await createCardOneStep(orderInputFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as { code?: string }).code).toBe("EFI_RATE_LIMITED");
    expect((err as { retryable?: boolean }).retryable).toBe(true);
  });
});

describe("getCardInstallments() — installments estimator (D-22, service.py:575-617)", () => {
  it("calls GET /v1/charge/card/installments?total={cents}&brand={brand} on family cobrancas", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ data: { installments: [] } });
    const { getCardInstallments } = await import("./card");

    await getCardInstallments("visa", 15990);

    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
    expect(mocks.efiRequestSpy).toHaveBeenCalledWith({
      family: "cobrancas",
      path: "/v1/charge/card/installments?total=15990&brand=visa",
      method: "GET",
    });
  });

  it("formats Efí options to {installment, installment_value, total_value, interest_percentage, has_interest} (service.py:604-612)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({
      data: {
        installments: [
          { installment: 1, value: 15990, interest_percentage: 0, has_interest: false },
          { installment: 3, value: 5453, interest_percentage: 2.55, has_interest: true },
        ],
      },
    });
    const { getCardInstallments } = await import("./card");

    const result = await getCardInstallments("visa", 15990);

    expect(result.installments).toEqual([
      { installment: 1, installment_value: 159.9, total_value: 159.9, interest_percentage: 0, has_interest: false },
      { installment: 3, installment_value: 54.53, total_value: 163.59, interest_percentage: 2.55, has_interest: true },
    ]);
  });

  it("rejects an invalid brand with a PT-BR error and never calls Efí (service.py:579-584)", async () => {
    const { getCardInstallments } = await import("./card");

    const err = await getCardInstallments("diners" as "visa", 15990).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect((err as { error?: string }).error).toContain("Bandeira");
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });
});

describe("createCardOneStep() — single-charge + paid_at guards (CR-02, service.py:325-334)", () => {
  it("rejects an order that already has a card charge — never mints a second Efí charge", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(
      dbOrderFixture({ efipay_charge_card_id: "charge-ja-existente" }),
    );
    const { createCardOneStep } = await import("./card");

    const err = await createCardOneStep(orderInputFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    // service.py:325-327 — idempotent rejection, no Efí call at all.
    expect((err as { code?: string }).code).toBe("EFI_INVALID_REQUEST");
    expect((err as { error?: string }).error).toContain("cobrança de cartão associada");
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });

  it("rejects an order whose paid_at is already set (service.py:330-334)", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(
      dbOrderFixture({ paid_at: new Date("2020-01-01T00:00:00.000Z") }),
    );
    const { createCardOneStep } = await import("./card");

    const err = await createCardOneStep(orderInputFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as { code?: string }).code).toBe("PAYMENT_ALREADY_PAID");
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });

  it("rejects an order whose reservation expired — fail-closed parity with createPixCharge (WR-06, D-08)", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(
      dbOrderFixture({ reservation_expires_at: new Date("2020-01-01T00:00:00.000Z") }),
    );
    const { createCardOneStep } = await import("./card");

    const err = await createCardOneStep(orderInputFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as { code?: string }).code).toBe("PAYMENT_EXPIRED");
    expect((err as { error?: string }).error).toContain("prazo de reserva");
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });

  it("still allows the happy path when no charge id and no paid_at are present", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue(dbOrderFixture());
    mocks.efiRequestSpy.mockResolvedValue({ charge_id: "12345", status: "AUTHORIZED" });
    const { createCardOneStep } = await import("./card");

    await expect(createCardOneStep(orderInputFixture())).resolves.toMatchObject({
      status: "PAID",
    });
    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
  });
});