-- C1: cimiento de pagos compartidos (demo → backend)
-- Semántica alineada a PaymentRow / docs/operational-money.md
-- Aún no es fuente de verdad de la app (sigue localStorage hasta C3/C4).

create extension if not exists "pgcrypto";

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  -- Código de negocio (PG-…); único para idempotencia / banco
  ref text not null unique,
  loan_ref text not null,
  client_ref text,
  collector_ref text,
  collector_name text,
  amount numeric(14, 2) not null check (amount > 0),
  paid_date date not null,
  paid_time text,
  due_date date,
  charge_label text,
  method text not null default 'efectivo',
  source text not null default 'ruta',
  payment_type text,
  payment_kind text,
  route_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create index if not exists payments_paid_date_idx on public.payments (paid_date desc);
create index if not exists payments_loan_ref_idx on public.payments (loan_ref);
create index if not exists payments_collector_ref_paid_date_idx
  on public.payments (collector_ref, paid_date desc);

comment on table public.payments is
  'Cobros canónicos. En fase C3+ son la raíz de plata; hasta entonces dual-write opcional.';

alter table public.payments enable row level security;

-- Borrador RLS: ajustar roles reales en C2 (admin vs cobrador).
-- Por ahora políticas permisivas solo si hay JWT; sin política = denegado para anon.

create policy "payments_select_authenticated"
  on public.payments
  for select
  to authenticated
  using (true);

create policy "payments_insert_authenticated"
  on public.payments
  for insert
  to authenticated
  with check (true);

create policy "payments_update_authenticated"
  on public.payments
  for update
  to authenticated
  using (true)
  with check (true);
