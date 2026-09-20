// Checkout types — single typed contract for the checkout API and form components.
// Parity with Python backend CheckoutRequest (RESEARCH §5.2):
//   recipient_name ≥3, recipient_document 11-14 (CPF/CNPJ),
//   recipient_email, recipient_phone 10-15, street, number, complement?,
//   neighborhood, city, state 2 (UF), postal_code 8 digits,
//   shipping_option_id, usar_seguro=false.

export type CheckoutRequest = {
  recipient_name: string;
  recipient_document: string;
  recipient_email: string;
  recipient_phone: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string;
  shipping_option_id: number;
  // Freight data from the selected option (client sends these so the server
  // does not need to re-fetch from Python at checkout time).
  shipping_carrier: string;
  shipping_method: string;
  shipping_cost: number;
  shipping_original: number;
  shipping_delivery_days: number;
  usar_seguro?: boolean;
};

export type CheckoutResponse = {
  redirect: string;
  expires_in_seconds: number;
};

/** Freight quote option returned by POST /api/freight/quote (proxied from Python). */
export type FreightOption = {
  id: number;
  nome: string;
  empresa: string;
  empresa_picture?: string;
  preco: number;
  preco_com_desconto?: number;
  prazo_dias: number;
  entrega_domiciliar?: boolean;
  entrega_sabado?: boolean;
  peso_gramas?: number;
};
