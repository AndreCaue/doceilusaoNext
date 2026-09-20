"use client";

// Checkout form client component (CHECKOUT-01, CHECKOUT-02).
// Two-column grid: left = address form ("Entrega") + freight options
// (triggered by 8-digit CEP → POST /api/freight/quote proxied to Python);
// right = sticky "Resumo do pedido" card with item list, freight cost from the
// selected option, and totals. Submit POSTs /api/checkout and redirects to the
// order confirmation on success.
//
// Threat: all values are re-validated server-side by the zod schema at
// /api/checkout — client validation is UX only (T-28-04-04).

import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCart } from "@/hooks/useCart";
import type { CheckoutRequest, FreightOption } from "@/lib/types/checkout";
import { ActiveOrderBanner } from "./ActiveOrderBanner";
import { useActiveOrder } from "./useActiveOrder";

const formatBRL = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

// ─── zod schema — pydantic parity (display copy, server re-validates) ───
const checkoutSchema = z.object({
  recipient_name: z.string().min(3, "Nome deve ter pelo menos 3 caracteres"),
  recipient_document: z
    .string()
    .min(11, "Documento deve ter 11-14 caracteres")
    .max(14, "Documento deve ter 11-14 caracteres"),
  recipient_email: z.string().email("Email inválido"),
  recipient_phone: z
    .string()
    .min(10, "Telefone deve ter 10-15 caracteres")
    .max(15, "Telefone deve ter 10-15 caracteres"),
  street: z.string().min(1, "Rua é obrigatória"),
  number: z.string().min(1, "Número é obrigatório"),
  complement: z.string().optional(),
  neighborhood: z.string().min(1, "Bairro é obrigatório"),
  city: z.string().min(1, "Cidade é obrigatória"),
  state: z.string().length(2, "Selecione o estado"),
  postal_code: z.string().length(8, "CEP deve ter 8 dígitos"),
});

const UF_OPTIONS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

const onlyDigits = (value: string) => value.replace(/\D/g, "");

const CheckoutForm = () => {
  const router = useRouter();
  const { summary, loading } = useCart();
  // ORDER-02 gate: single fetch per page; banner + submit guard derive from it.
  const activeOrder = useActiveOrder();

  // ─── form state ───
  const [form, setForm] = useState({
    recipient_name: "",
    recipient_document: "",
    recipient_email: "",
    recipient_phone: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    postal_code: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // ─── freight state ───
  const [freightOptions, setFreightOptions] = useState<FreightOption[]>([]);
  const [selectedOptionId, setSelectedOptionId] = useState<string>("");
  const [freightLoading, setFreightLoading] = useState(false);
  const [freightError, setFreightError] = useState<string | null>(null);

  const setField = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ─── cart-derived values ───
  const items = summary?.items ?? [];
  const cartEmpty = !summary || items.length === 0;
  const subtotal = summary?.subtotal ?? 0;
  const discount = summary?.discount ?? 0;

  const freightItems = useMemo(
    () =>
      items.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
      })),
    [items],
  );

  const valorDeclarado = subtotal - discount;

  const selectedOption = freightOptions.find(
    (opt) => String(opt.id) === selectedOptionId,
  );
  const freightCost = selectedOption?.preco ?? 0;
  const total = subtotal - discount + freightCost;

  // ─── freight quote trigger: 8-digit CEP + non-empty cart ───
  const cepComplete =
    form.postal_code.length === 8 && /^\d{8}$/.test(form.postal_code);

  const fetchFreight = useCallback(async () => {
    if (!cepComplete || cartEmpty || freightItems.length === 0) return;
    setFreightLoading(true);
    setFreightError(null);
    setFreightOptions([]);
    setSelectedOptionId("");
    try {
      const res = await fetch("/api/freight/quote", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: freightItems,
          cart_id: summary?.id ?? 0,
          cep_destino: form.postal_code,
          valor_declarado: valorDeclarado,
        }),
      });

      const body = (await res.json().catch(() => null)) as
        | FreightOption[]
        | { error?: string; code?: string }
        | null;

      if (!res.ok) {
        // 504 timeout / 424 no options → friendly copy
        if (res.status === 504) {
          setFreightError("O servidor de frete demorou para responder.");
        } else if (res.status === 424) {
          setFreightError("Nenhuma opção de frete disponível para este CEP.");
        } else if (body && typeof body === "object" && "error" in body) {
          setFreightError(body.error ?? "Erro ao calcular frete");
        } else {
          setFreightError(
            "Não foi possível processar sua solicitação. Tente novamente.",
          );
        }
        return;
      }

      if (Array.isArray(body)) {
        setFreightOptions(body);
        if (body.length === 0) {
          setFreightError("Nenhuma opção de frete disponível para este CEP.");
        }
      } else {
        setFreightOptions([]);
        setFreightError(
          "Não foi possível processar sua solicitação. Tente novamente.",
        );
      }
    } catch {
      setFreightError(
        "Não foi possível processar sua solicitação. Tente novamente.",
      );
    } finally {
      setFreightLoading(false);
    }
  }, [
    cepComplete,
    cartEmpty,
    freightItems,
    form.postal_code,
    summary,
    valorDeclarado,
  ]);

  useEffect(() => {
    if (cepComplete) {
      void fetchFreight();
    }
  }, [cepComplete, fetchFreight]);

  // ─── submit ───
  const handleSubmit = async () => {
    setSubmitError(null);

    // ORDER-02 gate (client side): a live reservation blocks checkout on the
    // client too. The server re-checks (409 ACTIVE_RESERVATION) — this guard
    // is UX only, never authoritative (T-30-06-02).
    if (activeOrder.hasActive) {
      setSubmitError(
        activeOrder.message || "Você já tem um pedido em andamento.",
      );
      return;
    }

    const parsed = checkoutSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "");
        if (field && !nextErrors[field]) {
          nextErrors[field] = issue.message;
        }
      }
      setErrors(nextErrors);
      toast.error("Confira os campos destacados");
      return;
    }

    if (!selectedOption) {
      setSubmitError("Selecione uma opção de frete.");
      return;
    }

    setSubmitting(true);
    try {
      const payload: CheckoutRequest = {
        recipient_name: form.recipient_name,
        recipient_document: form.recipient_document,
        recipient_email: form.recipient_email,
        recipient_phone: form.recipient_phone,
        street: form.street,
        number: form.number,
        complement: form.complement || undefined,
        neighborhood: form.neighborhood,
        city: form.city,
        state: form.state,
        postal_code: form.postal_code,
        shipping_option_id: selectedOption.id,
        shipping_carrier: selectedOption.empresa,
        shipping_method: selectedOption.nome,
        shipping_cost: selectedOption.preco,
        shipping_original:
          selectedOption.preco_com_desconto ?? selectedOption.preco,
        shipping_delivery_days: selectedOption.prazo_dias,
      };

      const res = await fetch("/api/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => null)) as
        | { redirect?: string; expires_in_seconds?: number }
        | { error?: string; code?: string }
        | null;

      if (!res.ok) {
        const errorBody = body as { error?: string; code?: string } | null;
        const message = errorBody?.error ?? "Erro ao finalizar compra";

        if (errorBody?.code === "INSUFFICIENT_STOCK") {
          // The checkout transaction rolls back on stock errors — cart items are
          // preserved, so the user just needs to adjust quantities here.
          setSubmitError(
            `${message} — ajuste as quantidades no carrinho e tente novamente.`,
          );
          toast.error("Estoque insuficiente", { duration: 5000 });
        } else {
          setSubmitError(message);
          toast.error(message, { duration: 4000 });
        }
        return;
      }

      const successBody = body as { redirect?: string } | null;
      if (successBody?.redirect) {
        router.push(successBody.redirect);
      } else {
        router.push("/checkout");
      }
    } catch {
      setSubmitError(
        "Não foi possível processar sua solicitação. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ─── empty cart guard ───
  if (!loading && cartEmpty) {
    return (
      <section className="py-24 md:py-32">
        <div className="max-w-6xl mx-auto px-6 text-center space-y-6">
          <h2 className="text-3xl md:text-4xl font-light tracking-widest text-white/90">
            Seu carrinho está vazio
          </h2>
          <p className="text-gray-300 text-lg">
            Adicione produtos antes de iniciar o checkout.
          </p>
          <Button className="h-10" onClick={() => router.push("/loja")}>
            Explorar loja
          </Button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <ActiveOrderBanner {...activeOrder} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left column — address + freight */}
        <div className="space-y-8">
          <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-6">
            <h3 className="text-xl font-semibold text-slate-200 mb-6">
              Entrega
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="recipient_name">Nome completo</Label>
                <Input
                  id="recipient_name"
                  value={form.recipient_name}
                  onChange={(e) => setField("recipient_name", e.target.value)}
                  placeholder="Seu nome completo"
                />
                {errors.recipient_name && (
                  <p className="text-sm text-destructive">
                    {errors.recipient_name}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipient_document">CPF/CNPJ</Label>
                <Input
                  id="recipient_document"
                  value={form.recipient_document}
                  onChange={(e) =>
                    setField(
                      "recipient_document",
                      onlyDigits(e.target.value).slice(0, 14),
                    )
                  }
                  placeholder="Somente números"
                  inputMode="numeric"
                />
                {errors.recipient_document && (
                  <p className="text-sm text-destructive">
                    {errors.recipient_document}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipient_phone">Telefone</Label>
                <Input
                  id="recipient_phone"
                  value={form.recipient_phone}
                  onChange={(e) =>
                    setField(
                      "recipient_phone",
                      onlyDigits(e.target.value).slice(0, 15),
                    )
                  }
                  placeholder="Somente números"
                  inputMode="numeric"
                />
                {errors.recipient_phone && (
                  <p className="text-sm text-destructive">
                    {errors.recipient_phone}
                  </p>
                )}
              </div>

              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="recipient_email">Email</Label>
                <Input
                  id="recipient_email"
                  type="email"
                  value={form.recipient_email}
                  onChange={(e) => setField("recipient_email", e.target.value)}
                  placeholder="voce@email.com"
                />
                {errors.recipient_email && (
                  <p className="text-sm text-destructive">
                    {errors.recipient_email}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="street">Rua</Label>
                <Input
                  id="street"
                  value={form.street}
                  onChange={(e) => setField("street", e.target.value)}
                  placeholder="Nome da rua"
                />
                {errors.street && (
                  <p className="text-sm text-destructive">{errors.street}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="number">Número</Label>
                <Input
                  id="number"
                  value={form.number}
                  onChange={(e) => setField("number", e.target.value)}
                  placeholder="123"
                />
                {errors.number && (
                  <p className="text-sm text-destructive">{errors.number}</p>
                )}
              </div>

              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="complement">Complemento (opcional)</Label>
                <Input
                  id="complement"
                  value={form.complement}
                  onChange={(e) => setField("complement", e.target.value)}
                  placeholder="Apto, bloco..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="neighborhood">Bairro</Label>
                <Input
                  id="neighborhood"
                  value={form.neighborhood}
                  onChange={(e) => setField("neighborhood", e.target.value)}
                  placeholder="Seu bairro"
                />
                {errors.neighborhood && (
                  <p className="text-sm text-destructive">
                    {errors.neighborhood}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input
                  id="city"
                  value={form.city}
                  onChange={(e) => setField("city", e.target.value)}
                  placeholder="Sua cidade"
                />
                {errors.city && (
                  <p className="text-sm text-destructive">{errors.city}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="state">Estado (UF)</Label>
                <Select
                  value={form.state}
                  onValueChange={(value) => setField("state", value)}
                >
                  <SelectTrigger id="state" className="w-full">
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    {UF_OPTIONS.map((uf) => (
                      <SelectItem key={uf} value={uf}>
                        {uf}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.state && (
                  <p className="text-sm text-destructive">{errors.state}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="postal_code">CEP</Label>
                <Input
                  id="postal_code"
                  value={form.postal_code}
                  onChange={(e) =>
                    setField(
                      "postal_code",
                      onlyDigits(e.target.value).slice(0, 8),
                    )
                  }
                  placeholder="00000000"
                  inputMode="numeric"
                />
                {errors.postal_code && (
                  <p className="text-sm text-destructive">
                    {errors.postal_code}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Freight section */}
          <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-6">
            <h3 className="text-xl font-semibold text-slate-200 mb-4">
              Opções de entrega
            </h3>

            {!cepComplete ? (
              <p className="text-sm text-muted-foreground">
                Digite o CEP completo para calcular o frete.
              </p>
            ) : freightLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : freightError ? (
              <div className="space-y-4">
                <p className="text-sm text-destructive">{freightError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchFreight()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : freightOptions.length > 0 ? (
              <RadioGroup
                value={selectedOptionId}
                onValueChange={setSelectedOptionId}
                className="gap-3"
              >
                {freightOptions.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-start gap-3 rounded-lg border border-slate-700 p-4 cursor-pointer hover:border-emerald-500/60 transition-colors data-[state=checked]:border-emerald-500"
                  >
                    <RadioGroupItem
                      value={String(opt.id)}
                      id={`freight-${opt.id}`}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-200">
                          {opt.empresa}
                        </p>
                        <p className="font-semibold text-slate-200">
                          {formatBRL(opt.preco)}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {opt.nome} — entrega em {opt.prazo_dias}{" "}
                        {opt.prazo_dias === 1 ? "dia" : "dias"}
                      </p>
                      {(opt.entrega_domiciliar || opt.entrega_sabado) && (
                        <div className="flex gap-2 mt-2">
                          {opt.entrega_domiciliar && (
                            <span className="text-xs rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5">
                              Receber em casa
                            </span>
                          )}
                          {opt.entrega_sabado && (
                            <span className="text-xs rounded-full bg-emerald-500/15 text-emerald-400 px-2 py-0.5">
                              Entrega aos sábados
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </RadioGroup>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma opção de frete disponível para este CEP.
              </p>
            )}
          </div>
        </div>

        {/* Right column — sticky order summary */}
        <div className="lg:sticky lg:top-24 h-fit">
          <div className="rounded-xl bg-neutral-900/60 backdrop-blur p-6 space-y-4">
            <h3 className="text-xl font-semibold text-slate-200">
              Resumo do pedido
            </h3>

            <div className="space-y-3">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="relative h-12 w-12 rounded-md overflow-hidden bg-slate-800 flex-shrink-0">
                    {item.img_product ? (
                      <Image
                        src={item.img_product}
                        alt={item.product_name}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="h-full w-full bg-slate-700 flex items-center justify-center text-xs text-muted-foreground">
                        &#128247;
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">
                      {item.product_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatBRL(item.unit_price)}
                    </p>
                  </div>
                  <p className="text-sm text-slate-200">
                    {formatBRL(item.total_price)}
                  </p>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-800 pt-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="text-slate-200">{formatBRL(subtotal)}</span>
              </div>

              {discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Desconto</span>
                  <span className="text-green-400">-{formatBRL(discount)}</span>
                </div>
              )}

              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Frete</span>
                <span className="text-slate-200">
                  {selectedOption ? formatBRL(freightCost) : "—"}
                </span>
              </div>

              <div className="border-t border-slate-800 pt-4 flex justify-between items-center">
                <span className="text-xl font-semibold text-slate-200">
                  Total
                </span>
                <span className="text-xl font-semibold text-slate-200">
                  {formatBRL(total)}
                </span>
              </div>
            </div>

            {submitError && (
              <div
                role="alert"
                className="rounded-lg bg-red-500/15 border border-red-500/40 px-4 py-3 text-sm text-red-400"
              >
                {submitError}
              </div>
            )}

            <Button
              className="w-full h-10 bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white border border-green-700 text-base"
              onClick={() => void handleSubmit()}
              disabled={submitting || cartEmpty || activeOrder.hasActive}
              title={
                activeOrder.hasActive
                  ? "Você já tem um pedido em andamento"
                  : undefined
              }
            >
              {submitting ? "Processando..." : "Finalizar compra"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export { CheckoutForm };
