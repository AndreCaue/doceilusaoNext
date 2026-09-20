"use client";

// Cartão de crédito panel (Plan 29-05) — parity Frontend CardPayment.tsx:
//   - Installments dropdown (D-22): POST /api/payment/card/installments
//     {brand, total} on card-number blur (parity handleGetParcelas)
//   - In-browser tokenization via payment-token-efi (D-20): PAN/cvv NEVER
//     leave the browser; only the payment_token reaches the Next server
//     (/api/payment/card/one-step {orderUuid, payment_token, parcelas} — D-21)
//   - Validation port of the parity zod schema (numero_cartao, nome_titular,
//     validade MM/AA, cvv, parcelas); cardholder CPF (holderDocument) comes
//     from the order's shipping recipient_document (parity
//     orderData.user.recipient_document).
//   - T-25-03: no log/emit of card data anywhere in this component.

import React from "react";
import { useCallback, useState } from "react";
import type { JSX } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import EfiPay from "payment-token-efi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OrderConfirmationData } from "./types";

const ACCOUNT_EFI_ID = process.env.NEXT_PUBLIC_EFI_ACCOUNTID ?? "";
const EFI_ENVIRONMENT = process.env.NEXT_PUBLIC_EFI_ENVIRONMENT ?? "";
const TOKENIZATION_CONFIGURED = Boolean(ACCOUNT_EFI_ID && EFI_ENVIRONMENT);

type InstallmentOption = {
  installment: number;
  installment_value: number;
  total_value: number;
  interest_percentage: number;
  has_interest: boolean;
};

type CardFields =
  | "numero_cartao"
  | "nome_titular"
  | "validade"
  | "cvv"
  | "parcelas";
type FormErrors = Partial<Record<CardFields, string>>;

/** Parity Frontend/src/Pages/Checkout/utils.ts detectCardBrand. */
function detectCardBrand(cardNumber: string): string {
  const cleaned = cardNumber.replace(/\D/g, "");
  if (!cleaned || cleaned.length < 6) return "";
  const bin = cleaned.slice(0, 6);
  if (/^4/.test(bin)) return "visa";
  if (/^5[1-5]/.test(bin)) return "mastercard";
  if (/^3[47]/.test(bin)) return "amex";
  if (/^(50[67]|50[89]|509|6277|63[67]|650|651)/.test(bin)) return "elo";
  if (/^(606282|3841)/.test(bin)) return "hipercard";
  return "";
}

/** MM/AA auto-format (parity formatExpiry). */
function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length < 2
    ? digits
    : `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function CardPanel({
  order,
}: {
  order: OrderConfirmationData;
}): JSX.Element {
  const router = useRouter();
  const [cardNumber, setCardNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [parcelas, setParcelas] = useState<number | undefined>(undefined);
  const [installments, setInstallments] = useState<InstallmentOption[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loadingParcelas, setLoadingParcelas] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  // Parity validate: nome_titular ≥5 chars, letters+spaces, ≥2 parts, not
  // all-same letters; validade not expired, not > +20y; cvv ≥3 digits.
  const validateAll = useCallback((): boolean => {
    const next: FormErrors = {};

    const digits = cardNumber.replace(/\D/g, "");
    if (!digits) next.numero_cartao = "Número do cartão inválido";

    const name = holderName.trim();
    const nameParts = name.split(/\s+/);
    const nameOk =
      name.length >= 5 &&
      /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/.test(name) &&
      nameParts.length >= 2 &&
      !nameParts.every((part) => new Set(part.toLowerCase()).size === 1);
    if (!nameOk)
      next.nome_titular = "Informe o nome completo como está no cartão";

    const match = /^(\d{2})\/(\d{2})$/.exec(expiry);
    let expiryOk = false;
    if (match) {
      const month = Number(match[1]);
      const year = Number(match[2]);
      const now = new Date();
      const currentYear = now.getFullYear() % 100;
      const currentMonth = now.getMonth() + 1;
      expiryOk =
        month >= 1 &&
        month <= 12 &&
        (year > currentYear ||
          (year === currentYear && month >= currentMonth)) &&
        year <= currentYear + 20;
    }
    if (!expiryOk) next.validade = "Data de validade do cartão inválida";

    if (!cvv || cvv.replace(/\D/g, "").length < 3) next.cvv = "CVV inválido";

    if (!parcelas || parcelas < 1)
      next.parcelas = "Selecione o número de parcelas";

    setErrors(next);
    return Object.keys(next).length === 0;
  }, [cardNumber, holderName, expiry, cvv, parcelas]);

  // Parity handleGetParcelas — installments fetch on card-number blur, once.
  const fetchInstallments = useCallback(async () => {
    const digits = cardNumber.replace(/\D/g, "");
    const detected = detectCardBrand(digits);
    if (!detected || installments.length > 0) return;

    setLoadingParcelas(true);
    try {
      const res = await fetch("/api/payment/card/installments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: detected, total: order.total ?? 0 }),
      });
      const data = (await res.json().catch(() => null)) as {
        installments?: InstallmentOption[];
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(data?.error ?? "Não foi possível carregar as parcelas");
        return;
      }
      setInstallments(data?.installments ?? []);
    } catch {
      toast.error("Erro de conexão ao carregar as parcelas");
    } finally {
      setLoadingParcelas(false);
    }
  }, [cardNumber, installments.length, order.total]);

  const handleCardNumberChange = useCallback((value: string) => {
    setCardNumber(value);
    if (!value.replace(/\D/g, "")) {
      // parity handleClearParcelas — cleared number clears the estimate.
      setInstallments([]);
      setParcelas(undefined);
    }
  }, []);

  // Parity generateToken — payment-token-efi browser tokenization (D-20/D-21).
  const tokenize = useCallback(async (): Promise<string | null> => {
    const digits = cardNumber.replace(/\D/g, "");
    const brand = detectCardBrand(digits);
    const [month, year] = expiry.split("/").map((part) => part.trim());
    const cpf = order.shipping?.recipient_document ?? "";

    if (!TOKENIZATION_CONFIGURED) {
      toast.error(
        "Pagamento via cartão temporariamente indisponível para esta loja",
      );
      return null;
    }
    if (!cpf) {
      toast.error("CPF do titular não informado no pedido");
      return null;
    }
    if (!digits || !month || !year || !cvv || !holderName.trim() || !brand) {
      toast.error("Preencha os dados do cartão corretamente");
      return null;
    }

    try {
      const tokenData = await EfiPay.CreditCard.setEnvironment(
        EFI_ENVIRONMENT as "production" | "sandbox",
      )
        .setAccount(ACCOUNT_EFI_ID)
        .setCardNumber(digits)
        .setCreditCardData({
          number: digits,
          cvv,
          expirationMonth: month.padStart(2, "0"),
          expirationYear: `20${year.padStart(2, "0")}`,
          holderName: holderName.trim(),
          reuse: false,
          brand,
          holderDocument: cpf,
        })
        .getPaymentToken();

      if ("payment_token" in tokenData) {
        return tokenData.payment_token;
      }
      throw new Error(tokenData.error_description || "Erro desconhecido");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha na tokenização do cartão";
      toast.error(message);
      return null;
    }
  }, [cardNumber, expiry, cvv, holderName, order.shipping?.recipient_document]);

  const handleSubmit = useCallback(async () => {
    if (!validateAll()) return;
    setSubmitting(true);
    try {
      const token = await tokenize();
      if (!token) return;

      const res = await fetch("/api/payment/card/one-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderUuid: order.uuid,
          payment_token: token,
          parcelas: parcelas ?? 1,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        status?: string;
        error?: string;
      } | null;

      if (res.ok) {
        if (data?.status === "PAID") {
          setApproved(true);
          toast.success("Pagamento aprovado");
          router.refresh(); // revalidate server state (WR-05 parity)
        } else if (data?.status === "FAILED") {
          toast.error("Pagamento recusado. Tente novamente ou use o PIX.");
        } else {
          // PENDING — parity UX: the webhook/reconcile path confirms next.
          toast.info(
            "Compra realizada com sucesso. Aguardando confirmação de pagamento.",
          );
        }
        return;
      }

      toast.error(data?.error ?? "Erro inesperado no pagamento");
    } catch {
      toast.error("Erro inesperado no pagamento");
    } finally {
      setSubmitting(false);
    }
  }, [validateAll, tokenize, order.uuid, parcelas, router]);

  if (approved) {
    return (
      <div className="py-8 text-center space-y-3">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
        <p className="text-base font-semibold text-slate-200">
          Pagamento aprovado
        </p>
        <p className="text-sm text-muted-foreground">
          Seu pedido está sendo processado.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-5 max-w-md mx-auto"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="numero_cartao">Número do Cartão</Label>
        <Input
          id="numero_cartao"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="1234 5678 9012 3456"
          className={errors.numero_cartao ? "border-red-600" : undefined}
          value={cardNumber}
          onChange={(event) => handleCardNumberChange(event.target.value)}
          onBlur={() => void fetchInstallments()}
          aria-invalid={Boolean(errors.numero_cartao)}
        />
        {errors.numero_cartao && (
          <p className="text-xs text-red-400">{errors.numero_cartao}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="nome_titular">Nome do Titular</Label>
        <Input
          id="nome_titular"
          autoComplete="cc-name"
          placeholder="Como está no cartão"
          className={errors.nome_titular ? "border-red-600" : undefined}
          value={holderName}
          onChange={(event) => setHolderName(event.target.value)}
          aria-invalid={Boolean(errors.nome_titular)}
        />
        {errors.nome_titular && (
          <p className="text-xs text-red-400">{errors.nome_titular}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="validade">Validade</Label>
          <Input
            id="validade"
            placeholder="MM/AA"
            autoComplete="cc-exp"
            className={errors.validade ? "border-red-600" : undefined}
            value={expiry}
            onChange={(event) => setExpiry(formatExpiry(event.target.value))}
            aria-invalid={Boolean(errors.validade)}
          />
          {errors.validade && (
            <p className="text-xs text-red-400">{errors.validade}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="cvv">CVV</Label>
          <Input
            id="cvv"
            type="password"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            className={errors.cvv ? "border-red-600" : undefined}
            value={cvv}
            onChange={(event) =>
              setCvv(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            aria-invalid={Boolean(errors.cvv)}
          />
          {errors.cvv && <p className="text-xs text-red-400">{errors.cvv}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Parcelas</Label>
        <Select
          value={parcelas !== undefined ? String(parcelas) : ""}
          onValueChange={(value) => setParcelas(Number(value))}
          disabled={loadingParcelas || installments.length === 0}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                loadingParcelas
                  ? "Carregando parcelas..."
                  : "Digite o número do cartão para ver as parcelas"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {installments.map((option) => (
              <SelectItem
                key={option.installment}
                value={String(option.installment)}
              >
                {option.installment}x de R${" "}
                {option.installment_value.toFixed(2)}
                {option.has_interest
                  ? ` - Juros de R$ ${(option.total_value - (order.total ?? 0)).toFixed(2)}`
                  : " - Sem juros"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.parcelas && (
          <p className="text-xs text-red-400">{errors.parcelas}</p>
        )}
      </div>

      {!TOKENIZATION_CONFIGURED && (
        <p className="text-xs text-amber-400/90">
          Pagamento via cartão indisponível no momento (tokenização não
          configurada).
        </p>
      )}

      <Button
        type="submit"
        className="w-full h-12 bg-gradient-to-r from-purple-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-base font-semibold"
        disabled={submitting || loadingParcelas}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Processando...
          </>
        ) : (
          `Pagar R$ ${(order.total ?? 0).toFixed(2).replace(".", ",")}`
        )}
      </Button>
    </form>
  );
}
