// POST /api/freight/quote — thin proxy to Python backend POST /melhor-envio/cotar.
//
// CHECKOUT-02: freight quotes are proxied (strangler-fig coexistence).
// The Python backend owns the Melhor Envio OAuth token and freight calculation.
// This route simply forwards the cart items + CEP and returns the options array.
//
// Threat mitigations:
//   T-28-04-05: 30s timeout inherited from proxyRequest; no direct Melhor Envio call
//   T-25-01: only "melhor-envio" is in the D-11 allowlist — proxyRequest enforces it

import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/jwt";
import { proxyRequest } from "@/lib/strangler-proxy";

type FreightItem = { product_id: number; quantity: number };

type FreightQuoteBody = {
  itens: FreightItem[];
  cart_id: number;
  cep_destino: string;
  valor_declarado: number;
};

export async function POST(req: NextRequest) {
  try {
    await getCurrentUser(req);

    const body = (await req.json()) as FreightQuoteBody;

    // Validate required fields (lightweight — full validation lives in the Python backend)
    if (
      !body.itens?.length ||
      !body.cep_destino ||
      body.cep_destino.length !== 8
    ) {
      return NextResponse.json(
        {
          error: "Dados inválidos para cálculo de frete",
          code: "VALIDATION_ERROR",
          retryable: false,
        },
        { status: 400 },
      );
    }

    const cookie = req.headers.get("cookie");
    const result = await proxyRequest("melhor-envio/cotar", {
      method: "POST",
      body: JSON.stringify({
        itens: body.itens,
        cart_id: body.cart_id,
        cep_destino: body.cep_destino,
        valor_declarado: body.valor_declarado,
      }),
      headers: { "Content-Type": "application/json" },
      cookies: cookie,
    });

    // Pass through the proxied response — success or error
    const parsedBody = (() => {
      try {
        return JSON.parse(result.body);
      } catch {
        return result.body;
      }
    })();

    return NextResponse.json(parsedBody, {
      status: result.status,
      headers: { "content-type": result.headers["content-type"] ?? "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      if (err.status === 401) {
        return NextResponse.json(
          { error: err.message, code: err.code, retryable: false },
          { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
        );
      }
      return NextResponse.json(
        { error: err.message, code: err.code, retryable: false },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: "Erro interno", code: "INTERNAL_ERROR", retryable: true },
      { status: 500 },
    );
  }
}
