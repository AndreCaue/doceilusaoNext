// PIX charge flow contract tests (Plan 29-02, TDD RED).
//
// Parity targets (29-CONTEXT D-06..D-09, D-13, D-16, D-17; Python
// `Backend/app/payment/service.py` create_pix_charge (101-227) +
// process_pix_webhook (229-304) + `Backend/app/payment/routes.py`):
//   - D-06: `valor.original` = grandTotalCents/100 toFixed(2) — the string
//     "159.90", NOT "159.9" (ZERO float drift).
//   - D-07: `calendario.expiracao` = reservation remaining minutes (min 60).
//   - D-08/D-09: expired reservation → EfiError PAYMENT_EXPIRED (fail-closed,
//     no Efí call).
//   - D-09/D-26: same orderUuid → same txid + ONE Efí call (module cache AND
//     persisted PixCharge lookup — a cold cache must still reuse the record).
//   - D-13: getPixChargeStatus re-queries Efí live (never trusts stale state).
//   - D-16: Efí status → PaymentStatus map (CONCLUIDA→PAID parity service.py).
//   - D-17: PAID invokes the injected confirmation hook (29-04 wires it); a
//     hook failure must never fail the poll read (webhook stays primary).
//   - T-25-03: PT-BR errors; no token/PIX key leakage in error payloads.
//
// NOTE: the plan's "mock @/server/db" target is actually `@/lib/prisma` — the
// real module exporting the `prisma` singleton (src/lib/prisma.ts). The
// PixCharge/Order writes below mirror the prisma schema field names
// (camelCase: efipayChargePixId, paymentStatus, paymentMethod, ...).
//
// Background: vitest + fake timers keep time fixed (NOW) so remaining-minutes
// assertions are deterministic.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  efiRequestSpy: vi.fn(),
  prisma: {
    pixCharge: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
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

// ─── Parity fixtures (the ONLY fields pix.ts reads — service.py parity) ─────

const NOW = new Date("2026-09-14T12:00:00.000Z");
const ORDER_UUID = "5b3c2e1a-9f8d-4c6b-a1e2-3f4d5e6a7b8c";
const CPF = "12345678909";
const BUYER_NAME = "Teste Homologacao";
const PIX_KEY = "teste@doceilusao.com.br";
const GRAND_TOTAL_CENTS = 15990;

const EFI_RESPONSE = {
  txid: "txid-parity-1",
  loc: { id: 1, location: "https://pix-h.api.efipay.com.br/qrcode/12345" },
  pixCopiaECola: "00020126580014br.gov.bcb.pix0136abc1234def",
  imagemQrcode: "data:image/png;base64,iVBORw0KGgo=",
};

function orderFixture(overrides: Partial<{ expiresAt: Date }> = {}) {
  return {
    uuid: ORDER_UUID,
    grandTotalCents: GRAND_TOTAL_CENTS,
    buyer: { cpf: CPF, name: BUYER_NAME },
    pixKey: PIX_KEY,
    // reservation expiry (D-07): now + 90 min → expiracao = 90 (deterministic
    // under fake timers)
    expiresAt: new Date(NOW.getTime() + 90 * 60_000),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.clearAllMocks();
  vi.resetModules();
  // Default DB stubs for the happy path (tests override as needed).
  // NOTE: the Prisma client exposes the schema's snake_case field names
  // (efipay_charge_pix_id, pix_copia_e_cola, ...) — the mocks mirror that.
  mocks.prisma.order.findUnique.mockResolvedValue({
    id: 7,
    uuid: ORDER_UUID,
    efipay_charge_pix_id: null,
  });
  mocks.prisma.pixCharge.create.mockResolvedValue({ id: 1, txid: "txid-parity-1" });
  mocks.prisma.order.update.mockResolvedValue({ uuid: ORDER_UUID });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("createPixCharge() — cob body parity (service.py:101-227, D-06/D-07)", () => {
  it("calls efiRequest with the parity body for POST /v2/cob (family pix)", async () => {
    mocks.efiRequestSpy.mockResolvedValue(EFI_RESPONSE);
    const { createPixCharge } = await import("./pix");

    await createPixCharge(orderFixture());

    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
    expect(mocks.efiRequestSpy).toHaveBeenCalledWith({
      family: "pix",
      path: "/v2/cob",
      method: "POST",
      body: {
        calendario: { expiracao: 90 }, // reservation remaining minutes (D-07)
        devedor: { nome: BUYER_NAME, cpf: CPF }, // order buyer parity service.py:170-172
        valor: { original: "159.90" }, // cents/100 toFixed(2) — ZERO float drift (D-06)
        chave: PIX_KEY, // pix key (D-06)
        solicitacaoPagador: expect.stringContaining(`#${ORDER_UUID}`),
      },
    });
  });

  it("clamps calendario.expiracao to a 60-minute minimum for short reservations (D-07)", async () => {
    mocks.efiRequestSpy.mockResolvedValue(EFI_RESPONSE);
    const { createPixCharge } = await import("./pix");

    await createPixCharge(orderFixture({ expiresAt: new Date(NOW.getTime() + 30 * 60_000) }));

    expect(mocks.efiRequestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ calendario: { expiracao: 60 } }),
      }),
    );
  });
});

describe("createPixCharge() — QR response + persistence parity", () => {
  it("returns { charge, qr } with the Efí QR payloads (Python response parity)", async () => {
    mocks.efiRequestSpy.mockResolvedValue(EFI_RESPONSE);
    const { createPixCharge } = await import("./pix");

    const result = await createPixCharge(orderFixture());

    expect(result.qr).toEqual({
      imagemQrcode: EFI_RESPONSE.imagemQrcode,
      pixCopiaECola: EFI_RESPONSE.pixCopiaECola,
      txid: EFI_RESPONSE.txid,
    });
    expect(result.charge.txid).toBe(EFI_RESPONSE.txid);

    // Persisted PixCharge mirrors the Efí payload (service.py:201-211) —
    // snake_case Prisma field names.
    expect(mocks.prisma.pixCharge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        txid: EFI_RESPONSE.txid,
        status: "ATIVA",
        pix_copia_e_cola: EFI_RESPONSE.pixCopiaECola,
        imagem_qrcode: EFI_RESPONSE.imagemQrcode,
        devedor_cpf: CPF,
        devedor_nome: BUYER_NAME,
        valor_original: 159.9,
        order_id: 7,
      }),
    });

    // Order linked to the charge + payment markers (parity routes.py:81).
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { uuid: ORDER_UUID },
      data: {
        efipay_charge_pix_id: EFI_RESPONSE.txid,
        payment_status: "PENDING",
        payment_method: "PIX",
      },
    });
  });

  it("rejects with PAYMENT_EXPIRED when the reservation has expired, without calling Efí (D-08/D-09)", async () => {
    const { createPixCharge } = await import("./pix");

    const err = await createPixCharge(
      orderFixture({ expiresAt: new Date(NOW.getTime() - 60_000) }),
    ).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeTruthy();
    expect((err as { code?: string }).code).toBe("PAYMENT_EXPIRED");
    expect(typeof (err as { error?: string }).error).toBe("string");
    // T-25-03 — never leak the PIX key in the error payload
    expect(JSON.stringify(err)).not.toContain(PIX_KEY);
    expect(mocks.efiRequestSpy).not.toHaveBeenCalled();
  });
});

describe("createPixCharge() — idempotency (D-09/D-26)", () => {
  it("returns the same charge for the same orderUuid with a single Efí call", async () => {
    mocks.efiRequestSpy.mockResolvedValue(EFI_RESPONSE);
    const { createPixCharge } = await import("./pix");

    const first = await createPixCharge(orderFixture());
    const second = await createPixCharge(orderFixture());

    // Module cache (D-09) — no double Efí call, no double charge.
    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
    expect(second.qr).toEqual(first.qr);
    expect(second.charge.txid).toBe(first.charge.txid);
  });

  it("cold-restores a persisted PixCharge AFTER a live re-query confirms it is still payable (WR-10)", async () => {
    // Cold module cache (serverless restart) — the order is already linked.
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: 7,
      uuid: ORDER_UUID,
      efipay_charge_pix_id: "txid-persisted",
    });
    mocks.prisma.pixCharge.findUnique.mockResolvedValue({
      id: 1,
      txid: "txid-persisted",
      location: "https://pix.example/loc-1",
      pix_copia_e_cola: "000201...persisted",
      imagem_qrcode: "data:image/png;base64,persisted",
      status: "ATIVA",
    });
    // WR-10 — cold cache trusts NO persisted status: it re-queries Efí live.
    mocks.efiRequestSpy.mockResolvedValue({ status: "ATIVA" });
    const { createPixCharge } = await import("./pix");

    const result = await createPixCharge(orderFixture());

    // ONE GET (live re-check), NO second cob mint (D-09/D-26).
    expect(mocks.efiRequestSpy).toHaveBeenCalledTimes(1);
    expect(mocks.efiRequestSpy).toHaveBeenCalledWith({
      family: "pix",
      path: "/v2/cob/txid-persisted",
      method: "GET",
    });
    expect(result.qr.txid).toBe("txid-persisted");
    expect(mocks.prisma.pixCharge.create).not.toHaveBeenCalled();
    expect(mocks.prisma.pixCharge.findUnique).toHaveBeenCalledWith({
      where: { txid: "txid-persisted" },
    });
  });

  it("rejects a persisted charge that already EXPIRED at Efí — PAYMENT_EXPIRED, no QR for a dead charge (WR-10)", async () => {
    mocks.prisma.order.findUnique.mockResolvedValue({
      id: 7,
      uuid: ORDER_UUID,
      efipay_charge_pix_id: "txid-morto",
    });
    mocks.prisma.pixCharge.findUnique.mockResolvedValue({
      id: 1,
      txid: "txid-morto",
      status: "ATIVA", // stale persisted row — the truth is at Efí
    });
    mocks.efiRequestSpy.mockResolvedValue({ status: "EXPIRADA" }); // live truth
    const { createPixCharge } = await import("./pix");

    const err = await createPixCharge(orderFixture()).then(
      () => null,
      (e: unknown) => e,
    );

    expect((err as { code?: string }).code).toBe("PAYMENT_EXPIRED");
    expect(mocks.prisma.pixCharge.create).not.toHaveBeenCalled(); // no re-mint
  });
});

describe("getPixChargeStatus() — live re-query + D-16 status map", () => {
  it("re-queries Efí live and maps CONCLUIDA → PAID with the fresh charge detail (D-13/D-16)", async () => {
    const efiDetail = {
      status: "CONCLUIDA",
      pix: [{ endToEndId: "E1234567890120240914000000000001" }],
      valor: { original: "159.90" },
    };
    mocks.efiRequestSpy.mockResolvedValue(efiDetail);
    const { getPixChargeStatus } = await import("./pix");

    const result = await getPixChargeStatus("txid-parity-1");

    expect(mocks.efiRequestSpy).toHaveBeenCalledWith({
      family: "pix",
      path: "/v2/cob/txid-parity-1",
      method: "GET",
    });
    expect(result.status).toBe("PAID");
    expect(result.charge).toEqual(efiDetail);
  });

  it.each([
    { efi: "ATIVA", expected: "PENDING" },
    { efi: "CONCLUIDA", expected: "PAID" },
    { efi: "EXPIRADA", expected: "EXPIRED" },
    { efi: "REMOVIDA_PELO_USUARIO_RECEBEDOR", expected: "CANCELED" },
    // WR-08 — an unknown term must NOT sever the poll loop → PENDING,
    // never FAILED (a payable charge stays payable).
    { efi: "ESTADO_DESCONHECIDO", expected: "PENDING" },
  ])("maps Efí status $efi → $expected (D-16 parity service.py)", async ({ efi, expected }) => {
    mocks.efiRequestSpy.mockResolvedValue({ status: efi });
    const { getPixChargeStatus } = await import("./pix");

    const result = await getPixChargeStatus("txid-map");

    expect(result.status).toBe(expected);
    if (expected === "PAID") {
      expect(result.charge).toBeDefined();
    } else {
      expect(result.charge).toBeUndefined();
    }
  });
});

describe("getPixChargeStatus() — terminal-state persistence (WR-05, parity service.py:286-298)", () => {
  it("persists EXPIRED onto the order (payment_status EXPIRED, status CANCELED) so the DB converges with Efí", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ status: "EXPIRADA" });
    mocks.prisma.pixCharge.findUnique.mockResolvedValue({
      id: 1,
      txid: "txid-expirou",
      order_id: 7,
    });
    const { getPixChargeStatus } = await import("./pix");

    const result = await getPixChargeStatus("txid-expirou");

    expect(result.status).toBe("EXPIRED");
    // WR-05 — the order can no longer sit PENDING forever after the charge died.
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { payment_status: "EXPIRED", status: "CANCELED" },
    });
  });

  it("persists REMOVIDA (CANCELED) the same way (D-08 — release, never re-reserve)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" });
    mocks.prisma.pixCharge.findUnique.mockResolvedValue({
      id: 1,
      txid: "txid-removido",
      order_id: 9,
    });
    const { getPixChargeStatus } = await import("./pix");

    const result = await getPixChargeStatus("txid-removido");

    expect(result.status).toBe("CANCELED");
    expect(mocks.prisma.order.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { payment_status: "CANCELED", status: "CANCELED" },
    });
  });

  it("never fails the read when terminal persistence errors (best-effort, D-13)", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ status: "EXPIRADA" });
    mocks.prisma.pixCharge.findUnique.mockRejectedValue(new Error("db indisponível"));
    const { getPixChargeStatus } = await import("./pix");

    const result = await getPixChargeStatus("txid-falha-persistencia");

    expect(result.status).toBe("EXPIRED"); // read still succeeds (D-13)
  });
});

describe("getPixChargeStatus() — D-17 reconcile hook", () => {
  it("invokes the injected confirmation hook on PAID and tolerates hook failures", async () => {
    mocks.efiRequestSpy.mockResolvedValue({
      status: "CONCLUIDA",
      pix: [{ endToEndId: "E1234567890120240914000000000001" }],
    });
    const { getPixChargeStatus, setConfirmPaymentHook } = await import("./pix");
    const hook = vi.fn().mockRejectedValue(new Error("confirmação indisponível (29-04 injeta)"));
    setConfirmPaymentHook(hook);

    const result = await getPixChargeStatus("txid-hook");

    expect(hook).toHaveBeenCalledWith("txid-hook");
    // Reconcile is best-effort (D-17) — the hook failure must NOT fail the poll read.
    expect(result.status).toBe("PAID");
  });

  it("does not invoke the confirmation hook for non-PAID statuses", async () => {
    mocks.efiRequestSpy.mockResolvedValue({ status: "ATIVA" });
    const { getPixChargeStatus, setConfirmPaymentHook } = await import("./pix");
    const hook = vi.fn();
    setConfirmPaymentHook(hook);

    await getPixChargeStatus("txid-pending");

    expect(hook).not.toHaveBeenCalled();
  });
});