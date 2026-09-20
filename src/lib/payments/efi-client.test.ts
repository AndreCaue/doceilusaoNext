// Efí transport contract tests (Plan 29-01, TDD RED).
//
// Parity targets (29-CONTEXT / 29-RESEARCH / Phase 25):
//   - D-04: OAuth token cache with TTL margin (expires_in - 60s) — second
//     authorize() within TTL must NOT hit the network.
//   - D-06: host map per family (pix vs cobranças), sandbox `-h` hosts.
//   - D-12: non-2xx → { error, code, retryable } PT-BR shape.
//   - D-15: sandbox-only bypass header forwarded via
//     getEfiSandboxConfig().extraHeaders (single source — never hardcoded).
//   - T-25-03: never surface raw client_id / client_secret / access_token in
//     request strings or error payloads.
//   - K-01: production family requests carry NO sandbox bypass header.
//
// NOTE: the real efi-cert module lives at package-root lib/efi-cert.ts (the
// `@/*` alias maps to src/*, so `@/lib/efi-cert` does not resolve). Both this
// test and efi-client.ts import it as `../../../lib/efi-cert`, so vi.mock
// intercepts the same resolved module id.
//
// The sandbox bypass header is `x-skip-mtls-checking` (Python parity:
// Backend/app/payment/service.py:312, setup_webhook.py:14; Phase 25
// EFI_SANDBOX_BYPASS_HEADER). "x-skip-matches-checking" was recorded as a typo
// in STATE.md.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EfiError } from "./types";

const mocks = vi.hoisted(() => ({
  requestSpy: vi.fn(),
  getEfiAgentSpy: vi.fn(),
  getEfiSandboxConfigSpy: vi.fn(),
}));

// node:https is CJS — vitest's interop requires a `default` export on the mock.
vi.mock("node:https", () => ({
  request: mocks.requestSpy,
  default: { request: mocks.requestSpy },
}));

vi.mock("../../../lib/efi-cert", () => ({
  getEfiAgent: mocks.getEfiAgentSpy,
  getEfiSandboxConfig: mocks.getEfiSandboxConfigSpy,
}));

// ─── Parity constants (29-RESEARCH §1, D-06) ────────────────────────────
const PIX_SANDBOX_BASE = "https://pix-h.api.efipay.com.br";
const PIX_PROD_BASE = "https://pix.api.efipay.com.br";
const CHARGES_SANDBOX_BASE = "https://cobrancas-h.api.efipay.com.br";
const CHARGES_PROD_BASE = "https://cobrancas.api.efipay.com.br";
const SANDBOX_HEADERS = { "x-skip-mtls-checking": "true" };

const TEST_CLIENT_ID = "test-client-id";
const TEST_CLIENT_SECRET = "test-client-secret";

type StubResponse = { status: number; body: unknown };
type RequestCall = [
  url: string,
  options: { method?: string; headers: Record<string, string | undefined>; agent?: unknown },
];

let capturedBodies: string[] = [];

/** FIFO stub for https.request: each call consumes exactly one queued response. */
function stubResponses(queue: StubResponse[]) {
  for (let i = 0; i < queue.length; i++) {
    mocks.requestSpy.mockImplementationOnce(
      (_url: unknown, _options: unknown, cb: (res: unknown) => void) => {
        const next = queue[i];
        const res = new EventEmitter() as EventEmitter & { statusCode?: number };
        res.statusCode = next.status;
        cb(res);
        queueMicrotask(() =>
          res.emit("data", typeof next.body === "string" ? next.body : JSON.stringify(next.body)),
        );
        queueMicrotask(() => res.emit("end"));
        return {
          on: vi.fn(),
          write: vi.fn((chunk: string) => {
            capturedBodies.push(String(chunk));
          }),
          end: vi.fn(),
          // WR-01 — the transport now arms a socket timeout on every request.
          setTimeout: vi.fn(),
        };
      },
    );
  }
}

function requestCalls(): RequestCall[] {
  return mocks.requestSpy.mock.calls as unknown as RequestCall[];
}

function expectEfiError(err: unknown, code: string, retryable: boolean) {
  expect(err).toBeTruthy();
  const e = err as EfiError;
  expect(e.code).toBe(code);
  expect(e.retryable).toBe(retryable);
  expect(typeof e.error).toBe("string");
  expect(e.error.length).toBeGreaterThan(0);
  // PT-BR parity — message must carry the Efí brand (never raw secrets).
  expect(e.error).toContain("Efí");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  capturedBodies = [];
  process.env.EFI_SANDBOX = "true";
  process.env.EFI_CLIENT_ID = TEST_CLIENT_ID;
  process.env.EFI_CLIENT_SECRET = TEST_CLIENT_SECRET;
  mocks.getEfiAgentSpy.mockImplementation(() => ({ hostname: "x" }));
  mocks.getEfiSandboxConfigSpy.mockImplementation(() => ({
    sandbox: true,
    baseUrl: PIX_SANDBOX_BASE,
    extraHeaders: SANDBOX_HEADERS,
  }));
  mocks.requestSpy.mockImplementation(() => {
    throw new Error("https.request called with no stubbed response");
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.EFI_SANDBOX;
  delete process.env.EFI_CLIENT_ID;
  delete process.env.EFI_CLIENT_SECRET;
});

describe("authorize() — OAuth client_credentials (D-04/D-06/D-15, T-25-03)", () => {
  it("POSTs grant_type=client_credentials to the sandbox PIX OAuth URL with Basic auth + mTLS agent", async () => {
    stubResponses([{ status: 200, body: { access_token: "tok-test-abc", expires_in: 1800 } }]);
    const { authorize } = await import("./efi-client");

    const token = await authorize();

    expect(token).toBe("tok-test-abc");
    expect(mocks.requestSpy).toHaveBeenCalledTimes(1);

    const [url, options] = requestCalls()[0];
    expect(url).toBe(`${PIX_SANDBOX_BASE}/v2/oauth/token`);

    const expectedBasic = `Basic ${Buffer.from(`${TEST_CLIENT_ID}:${TEST_CLIENT_SECRET}`).toString("base64")}`;
    expect(options.headers.Authorization).toBe(expectedBasic);
    expect(options.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    // D-15 — sandbox bypass header forwarded from getEfiSandboxConfig().extraHeaders
    expect(options.headers["x-skip-mtls-checking"]).toBe("true");
    // D-04 — mTLS agent passed through
    expect(options.agent).toEqual({ hostname: "x" });

    // grant_type=client_credentials form body
    expect(capturedBodies).toHaveLength(1);
    expect(capturedBodies[0]).toBe("grant_type=client_credentials");

    // T-25-03 — no raw client_id / client_secret / token in the request URL
    expect(url).not.toContain(TEST_CLIENT_ID);
    expect(url).not.toContain(TEST_CLIENT_SECRET);
    expect(url).not.toContain("tok-test-abc");
  });

  it("caches the token within the TTL margin — second authorize() does not re-request (D-04)", async () => {
    stubResponses([{ status: 200, body: { access_token: "tok-cached", expires_in: 3600 } }]);
    const { authorize } = await import("./efi-client");

    const first = await authorize();
    const second = await authorize();

    expect(first).toBe("tok-cached");
    expect(second).toBe("tok-cached");
    // TTL = expires_in(3600) - 60s margin → both calls within cache window
    expect(mocks.requestSpy).toHaveBeenCalledTimes(1);
  });
});

describe("efiRequest() — host map per family (D-06) + sandbox headers (D-15/D-04)", () => {
  it("routes the pix family to the sandbox PIX host with Bearer auth and JSON body", async () => {
    stubResponses([
      { status: 200, body: { access_token: "tok-bearer", expires_in: 3600 } },
      { status: 200, body: { id: "charge-1", status: "waiting" } },
    ]);
    const { efiRequest } = await import("./efi-client");

    const result = await efiRequest({
      family: "pix",
      path: "/v2/cob",
      method: "POST",
      body: { valor: 100 },
    });

    expect(result).toEqual({ id: "charge-1", status: "waiting" });
    expect(mocks.requestSpy).toHaveBeenCalledTimes(2);
    const [url, options] = requestCalls()[1];
    expect(url).toBe(`${PIX_SANDBOX_BASE}/v2/cob`);
    expect(options.headers.Authorization).toBe("Bearer tok-bearer");
    expect(options.headers["x-skip-mtls-checking"]).toBe("true");
    expect(JSON.parse(capturedBodies[1])).toEqual({ valor: 100 });
  });

  it("routes the cobrancas family to the sandbox CHARGES host with the charge path", async () => {
    stubResponses([
      { status: 200, body: { access_token: "tok2", expires_in: 3600 } },
      { status: 200, body: { status: "approved" } },
    ]);
    const { efiRequest } = await import("./efi-client");

    await efiRequest({ family: "cobrancas", path: "/v1/charge/one-step", method: "POST", body: { items: [] } });

    const [url, options] = requestCalls()[1];
    expect(url).toBe(`${CHARGES_SANDBOX_BASE}/v1/charge/one-step`);
    expect(options.headers["x-skip-mtls-checking"]).toBe("true");
  });

  it("never sends the sandbox bypass header in production (K-01, D-15 strip)", async () => {
    process.env.EFI_SANDBOX = "false";
    mocks.getEfiSandboxConfigSpy.mockImplementation(() => ({
      sandbox: false,
      baseUrl: PIX_PROD_BASE,
      extraHeaders: {},
    }));
    stubResponses([
      { status: 200, body: { access_token: "tok-prod", expires_in: 3600 } },
      { status: 200, body: { status: "ok" } },
    ]);
    const { efiRequest } = await import("./efi-client");

    await efiRequest({ family: "cobrancas", path: "/v1/charge/one-step", method: "GET" });

    const [url, options] = requestCalls()[1];
    expect(url).toBe(`${CHARGES_PROD_BASE}/v1/charge/one-step`);
    expect(options.headers["x-skip-mtls-checking"]).toBeUndefined();
  });
});

describe("efiRequest() — error parity (D-12)", () => {
  it("maps 401 to EFI_UNAUTHORIZED (non-retryable) and never leaks the token or secret", async () => {
    stubResponses([
      { status: 200, body: { access_token: "tok-secret-xyz", expires_in: 3600 } },
      { status: 401, body: { error: "unauthorized" } },
    ]);
    const { efiRequest } = await import("./efi-client");

    const err = await efiRequest({ family: "pix", path: "/v2/cob" }).then(
      () => null,
      (e: unknown) => e,
    );

    expectEfiError(err, "EFI_UNAUTHORIZED", false);
    // T-25-03 — error payload never contains the access token or raw secret
    expect(JSON.stringify(err)).not.toContain("tok-secret-xyz");
    expect(JSON.stringify(err)).not.toContain(TEST_CLIENT_SECRET);
  });

  it.each([
    { status: 429, code: "EFI_RATE_LIMITED", retryable: true },
    { status: 503, code: "EFI_SERVER_ERROR", retryable: true },
    { status: 500, code: "EFI_SERVER_ERROR", retryable: true },
  ])("maps HTTP $status → $code (retryable=$retryable)", async ({ status, code, retryable }) => {
    stubResponses([
      { status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { status, body: { error: "nope" } },
    ]);
    const { efiRequest } = await import("./efi-client");

    const err = await efiRequest({ family: "pix", path: "/v2/cob" }).then(
      () => null,
      (e: unknown) => e,
    );

    expectEfiError(err, code, retryable);
  });
});

describe("efiRequest() — transport robustness (WR-01)", () => {
  it("rejects EFI_UNREACHABLE when the RESPONSE stream errors mid-body (socket reset before end)", async () => {
    stubResponses([{ status: 200, body: { access_token: "tok", expires_in: 3600 } }]);
    mocks.requestSpy.mockImplementationOnce((_url: unknown, _options: unknown, cb: (res: unknown) => void) => {
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = 200;
      cb(res);
      // Data begins to arrive, then the socket dies — 'error' on the response.
      queueMicrotask(() => res.emit("data", "parcial"));
      queueMicrotask(() => res.emit("error", new Error("socket reset")));
      return {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        setTimeout: vi.fn(),
      };
    });
    const { efiRequest } = await import("./efi-client");

    const err = await efiRequest({ family: "pix", path: "/v2/cob" }).then(
      () => null,
      (e: unknown) => e,
    );

    // WR-01 — never pend forever: a mid-body reset settles as EFI_UNREACHABLE.
    expectEfiError(err, "EFI_UNREACHABLE", true);
  });

  it("rejects EFI_UNREACHABLE when the 15s socket timeout fires (silently dropped connection)", async () => {
    stubResponses([{ status: 200, body: { access_token: "tok", expires_in: 3600 } }]);
    mocks.requestSpy.mockImplementationOnce((_url: unknown, _options: unknown, cb: (res: unknown) => void) => {
      // The server never responds — no 'data', no 'end', no RST.
      const res = new EventEmitter() as EventEmitter & { statusCode?: number };
      res.statusCode = 200;
      cb(res);
      // Real-request stand-in: on timeout, destroy(err) → req 'error'.
      const reqMock = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        setTimeout: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      reqMock.write = vi.fn();
      reqMock.end = vi.fn();
      reqMock.setTimeout = vi.fn((_ms: number, fn: () => void) => {
        queueMicrotask(() => fn());
      });
      reqMock.destroy = vi.fn(() => {
        queueMicrotask(() => reqMock.emit("error", new Error("timeout")));
      });
      return reqMock;
    });
    const { efiRequest } = await import("./efi-client");

    const err = await efiRequest({ family: "pix", path: "/v2/cob" }).then(
      () => null,
      (e: unknown) => e,
    );

    expectEfiError(err, "EFI_UNREACHABLE", true);
  });
});