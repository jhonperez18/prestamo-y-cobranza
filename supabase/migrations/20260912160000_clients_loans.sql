-- C5: clientes y préstamos compartidos (demo → backend)
-- Semántica: ClientRow / LoanRow / docs/demo-to-backend.md

create extension if not exists "pgcrypto";

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  alta text not null default '',
  name text not null default '',
  last_name text not null default '',
  nickname text,
  document text not null default '',
  city text not null default '',
  barrio text not null default '',
  route text not null default '',
  route_order integer not null default 0,
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  photo text,
  lat double precision,
  lng double precision,
  total numeric(14, 2) not null default 0,
  pending numeric(14, 2) not null default 0,
  status text not null default 'Activo',
  kind text not null default 'ok',
  created_by text,
  awaiting_loan boolean not null default false,
  profile_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_route_idx on public.clients (route);
create index if not exists clients_updated_at_idx on public.clients (updated_at desc);

comment on table public.clients is
  'Clientes canónicos. C5 dual-write + pull; localStorage caché.';

create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  client_ref text not null,
  client_name text not null default '',
  start_date text not null default '',
  due_date text not null default '',
  capital numeric(14, 2) not null default 0,
  paid numeric(14, 2) not null default 0,
  balance numeric(14, 2) not null default 0,
  status text not null default 'Activo',
  kind text not null default 'ok',
  notes text,
  rate numeric(10, 4),
  frequency text,
  mode text,
  pact text,
  days integer,
  interest numeric(14, 2),
  total numeric(14, 2),
  installment numeric(14, 2),
  schedule jsonb,
  collection_alerts integer not null default 0,
  terms_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loans_client_ref_idx on public.loans (client_ref);
create index if not exists loans_updated_at_idx on public.loans (updated_at desc);

comment on table public.loans is
  'Préstamos canónicos. C5 dual-write + pull; saldos se re-proyectan desde PG-.';

alter table public.clients enable row level security;
alter table public.loans enable row level security;

drop policy if exists "clients_select_authenticated" on public.clients;
drop policy if exists "clients_insert_authenticated" on public.clients;
drop policy if exists "clients_update_authenticated" on public.clients;
drop policy if exists "clients_select_anon_c5" on public.clients;
drop policy if exists "clients_insert_anon_c5" on public.clients;
drop policy if exists "clients_update_anon_c5" on public.clients;

create policy "clients_select_authenticated"
  on public.clients for select to authenticated using (true);
create policy "clients_insert_authenticated"
  on public.clients for insert to authenticated with check (true);
create policy "clients_update_authenticated"
  on public.clients for update to authenticated using (true) with check (true);
create policy "clients_select_anon_c5"
  on public.clients for select to anon using (true);
create policy "clients_insert_anon_c5"
  on public.clients for insert to anon with check (true);
create policy "clients_update_anon_c5"
  on public.clients for update to anon using (true) with check (true);

drop policy if exists "loans_select_authenticated" on public.loans;
drop policy if exists "loans_insert_authenticated" on public.loans;
drop policy if exists "loans_update_authenticated" on public.loans;
drop policy if exists "loans_select_anon_c5" on public.loans;
drop policy if exists "loans_insert_anon_c5" on public.loans;
drop policy if exists "loans_update_anon_c5" on public.loans;

create policy "loans_select_authenticated"
  on public.loans for select to authenticated using (true);
create policy "loans_insert_authenticated"
  on public.loans for insert to authenticated with check (true);
create policy "loans_update_authenticated"
  on public.loans for update to authenticated using (true) with check (true);
create policy "loans_select_anon_c5"
  on public.loans for select to anon using (true);
create policy "loans_insert_anon_c5"
  on public.loans for insert to anon with check (true);
create policy "loans_update_anon_c5"
  on public.loans for update to anon using (true) with check (true);
