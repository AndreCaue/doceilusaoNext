// useActiveOrder contract tests (Plan 30-06, TDD RED — ORDER-02 gate hook).
//
// The hook consumes GET /api/orders/by-user (30-03) — the HasOrderResult wire
// shape from the 30-01 read layer — and derives the banner state:
//   - success:true  → { hasActive, message, expiresAt (expires_at_iso),
//                       orderUuid (from redirect when /checkout/<uuid>) }
//   - success:false → NO_ORDER parity: no banner state
//   - fetch rejects → fail-open availability (banner absent, loading false) —
//                     the SERVER gate (30-06 task 3, 409 ACTIVE_RESERVATION)
//                     still protects the invariant; the hook itself must not
//                     leak an unhandled rejection.
//
// fetch is stubbed per case (OrdersTable.test.tsx precedent); the hook module
// does not exist yet — RED fails on the missing module import.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useActiveOrder } from "./useActiveOrder";

const fetchMock = vi.fn<typeof fetch>();

function respondJson(body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => body,
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useActiveOrder — GET /api/orders/by-user gate hook", () => {
  it("success:true with redirect '/' → active reservation, no order link", async () => {
    respondJson({
      success: true,
      message: "Pedido aguardando...",
      redirect: "/",
      expires_at: 100,
      expires_at_iso: "2026-09-14T12:00:00.000Z",
    });

    const { result } = renderHook(() => useActiveOrder());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orders/by-user",
      expect.any(Object),
    );
    expect(result.current.hasActive).toBe(true);
    expect(result.current.message).toBe("Pedido aguardando...");
    expect(result.current.expiresAt).toBe("2026-09-14T12:00:00.000Z");
    expect(result.current.orderUuid).toBeNull();
  });

  it("redirect '/checkout/<uuid>' → orderUuid derived from the redirect path", async () => {
    respondJson({
      success: true,
      message: "Pedido aguardando pagamento...",
      redirect: "/checkout/11111111-1111-1111-1111-111111111111",
      expires_at: 100,
      expires_at_iso: "2026-09-14T12:00:00.000Z",
    });

    const { result } = renderHook(() => useActiveOrder());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasActive).toBe(true);
    expect(result.current.orderUuid).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  it("success:false (NO_ORDER parity) → no banner state", async () => {
    respondJson({
      success: false,
      message: "",
      redirect: null,
      expires_at: 0,
      expires_at_iso: null,
    });

    const { result } = renderHook(() => useActiveOrder());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.message).toBe("");
    expect(result.current.expiresAt).toBeNull();
    expect(result.current.orderUuid).toBeNull();
  });

  it("fetch rejects (network) → fail-open: no banner, loading false, no unhandled rejection", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useActiveOrder());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasActive).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("loading starts true and flips false after resolution", async () => {
    respondJson({
      success: false,
      message: "",
      redirect: null,
      expires_at: 0,
      expires_at_iso: null,
    });

    const { result } = renderHook(() => useActiveOrder());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.hasActive).toBe(false);
  });
});