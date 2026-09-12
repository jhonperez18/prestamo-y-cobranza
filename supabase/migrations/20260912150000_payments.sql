-- C1/C2: pagos compartidos (demo → backend)
-- Semántica: PaymentRow / docs/operational-money.md / docs/demo-to-backend.md

create extension if not exists "pgcrypto";

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
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
  'Cobros canónicos. C2 dual-write; C3+ fuente de verdad compartida.';

alter table public.payments enable row level security;

-- Autenticados (futuro login Supabase)
drop policy if exists "payments_select_authenticated" on public.payments;
drop policy if exists "payments_insert_authenticated" on public.payments;
drop policy if exists "payments_update_authenticated" on public.payments;

create policy "payments_select_authenticated"
  on public.payments for select to authenticated using (true);

create policy "payments_insert_authenticated"
  on public.payments for insert to authenticated with check (true);

create policy "payments_update_authenticated"
  on public.payments for update to authenticated using (true) with check (true);

-- C2 temporal: dual-write desde demo (anon key) hasta cerrar auth en C3.
-- Quitar estas políticas en C3 cuando el login Supabase sea obligatorio.
drop policy if exists "payments_select_anon_c2" on public.payments;
drop policy if exists "payments_insert_anon_c2" on public.payments;
drop policy if exists "payments_update_anon_c2" on public.payments;

create policy "payments_select_anon_c2"
  on public.payments for select to anon using (true);

create policy "payments_insert_anon_c2"
  on public.payments for insert to anon with check (true);

create policy "payments_update_anon_c2"
  on public.payments for update to anon using (true) with check (true);
