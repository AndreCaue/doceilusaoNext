"use client";

// PIX payment panel (Plan 29-05) — parity Frontend PixPayment.tsx:
//   - Charge creation: POST /api/payment/pix {orderUuid} → { txid,
//     imagem_qrcode, pix_copia_e_cola } (D-09 idempotent in the lib)
//   - QR: imagem_qrcode <img>; react-qr-code fallback on pix_copia_e_cola
//   - "Copiar" button (navigator.clipboard) + PT-BR sonner toasts
//   - 5s status poll GET /api/payment/pix/[txid] (D-15) → PAID → confirmed +
//     router.refresh() (revalidate parity, Phase 27 WR-05)
//   - T-25-03: this component never logs/emits the txid key or QR payload.

import React from "react";
import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import type { OrderConfirmationData } from "./types";

type PixChargeResponse = {
  txid?: string;
  imagem_qrcode?: string;
  pix_copia_e_cola?: string;
};

const POLL_INTERVAL_MS = 5000; // D-15
const COPY_RESET_MS = 2200; // parity PixPayment.tsx
const PAYMENT_TERMINAL_STATUSES = new Set(["EXPIRED", "CANCELED", "FAILED"]);

export function PixPanel({
  order,
}: {
  order: OrderConfirmationData;
}): JSX.Element {
  const router = useRouter();
  const [charge, setCharge] = useState<PixChargeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [paid, setPaid] = useState(false);

  const txid = charge?.txid ?? null;

  // Create (or restore — D-09) the charge for this order, once per mount.
  const createCharge = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payment/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderUuid: order.uuid }),
      });
      const data = (await res.json().catch(() => null)) as
        | (PixChargeResponse & { error?: string })
        | null;
      if (!res.ok) {
        setError(data?.error ?? "Erro ao gerar o PIX");
        return;
      }
      setCharge(data);
    } catch {
      setError("Erro de conexão ao gerar o PIX");
    } finally {
      setLoading(false);
    }
  }, [order.uuid]);

  useEffect(() => {
    void createCharge();
  }, [createCharge]);

  // D-15 — poll every 5s until a terminal status (D-16 stops). The PAID check
  // also runs the webhook-parity reconcile server-side (same confirmPayment),
  // then refreshes the server-rendered order state.
  useEffect(() => {
    if (!txid || paid) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/payment/pix/${encodeURIComponent(txid)}`);
        const data = (await res.json().catch(() => null)) as {
          status?: string;
          error?: string;
        } | null;

        if (!res.ok) {
          if (res.status >= 400 && res.status < 500) {
            clearInterval(timer); // terminal — charge gone / auth lost
            toast.error(
              data?.error ?? "Não foi possível verificar o pagamento",
            );
          }
          return; // 5xx → keep polling (D-15 retryable)
        }

        if (data?.status === "PAID") {
          clearInterval(timer);
          setPaid(true);
          toast.success("Pagamento confirmado");
          router.refresh(); // revalidate server state (WR-05 parity)
        } else if (data?.status && PAYMENT_TERMINAL_STATUSES.has(data.status)) {
          clearInterval(timer);
          toast.error(
            data.status === "EXPIRED"
              ? "O prazo de pagamento expirou"
              : "Esta cobrança PIX não pode mais ser paga",
          );
        }
      } catch {
        // transient network error — keep polling (D-15)
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [txid, paid, router]);

  const handleCopyPix = useCallback(async () => {
    const code = charge?.pix_copia_e_cola;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), COPY_RESET_MS);
      toast.success("Chave PIX copiada");
    } catch {
      toast.error("Não foi possível copiar a chave PIX");
    }
  }, [charge?.pix_copia_e_cola]);

  if (paid) {
    return (
      <div className="py-8 text-center space-y-3">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <p className="text-base font-semibold text-slate-200">
          Pagamento confirmado
        </p>
        <p className="text-sm text-muted-foreground">
          Recebemos o seu pagamento. Seu pedido está sendo processado.
        </p>
      </div>
    );
  }

  if (error && !charge) {
    return (
      <div className="py-8 text-center space-y-4">
        <p className="text-sm text-red-300">{error}</p>
        <Button variant="outline" onClick={() => void createCharge()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-2xl border border-emerald-500/20 bg-white p-3">
          {charge?.imagem_qrcode ? (
            <Image
              src={charge.imagem_qrcode}
              alt="QR Code PIX"
              width={196}
              height={196}
              unoptimized
              className="h-49 w-49 rounded-lg"
            />
          ) : loading ? (
            <div className="h-49 w-49 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            </div>
          ) : charge?.pix_copia_e_cola ? (
            <div className="rounded-lg bg-white p-2">
              <QRCode value={charge.pix_copia_e_cola} size={180} />
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Escaneie com o app do seu banco
        </p>
      </div>

      <div className="w-full max-w-md mx-auto space-y-4">
        <div className="rounded-xl border border-slate-800 bg-black/30 p-4">
          <p className="text-sm text-muted-foreground mb-2">Chave PIX</p>
          <div className="flex items-center justify-between gap-3">
            <code className="text-sm font-mono break-all text-slate-300">
              {charge?.pix_copia_e_cola ?? "Gerando..."}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => void handleCopyPix()}
              disabled={!charge?.pix_copia_e_cola}
              aria-label="Copiar chave PIX"
            >
              {pixCopied ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <Copy className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          </div>
        </div>

        <p className="text-center text-xl font-semibold text-emerald-400">
          {loading
            ? "Processando..."
            : `Pagar R$ ${(order.total ?? 0).toFixed(2).replace(".", ",")}`}
        </p>
      </div>
    </div>
  );
}
