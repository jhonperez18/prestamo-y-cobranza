-- Evidencia de cobro (comprobante Nequi / firma) en el pago canónico.
alter table public.payments
  add column if not exists evidence jsonb;

comment on column public.payments.evidence is
  'Array PaymentEvidenceRef liviano (sin data URL). previewUrl solo en cliente.';
