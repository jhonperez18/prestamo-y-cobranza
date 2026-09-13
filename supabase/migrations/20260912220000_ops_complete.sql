-- =============================================================================
-- C6 foundation: esquema operativo completo (nada suelto)
-- Raíces ya existentes: clients → loans → payments
-- Nuevas: profiles, collectors, routes, day_closes, day_expenses,
--         misc_payments, daily_assignments
-- Banco / logs diarios = PROYECCIÓN desde PG- (no tablas raíz aquí)
-- Ver: docs/supabase-schema.md
-- =============================================================================

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- PROFILES (Auth uid ↔ usuario de negocio) — listo para RLS por rol
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  login text not null unique,
  user_ref text,
  collector_ref text,
  role_id text not null default 'admin',
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_collector_ref_idx on public.profiles (collector_ref);
create index if not exists profiles_login_idx on public.profiles (login);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on table public.profiles is
  'Puente Auth → negocio. RLS C6 lee collector_ref / role_id desde aquí.';

-- ---------------------------------------------------------------------------
-- COLLECTORS
-- ---------------------------------------------------------------------------
create table if not exists public.collectors (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  name text not null default '',
  zone text not null default '',
  phone text not null default '',
  document text,
  notes text,
  active boolean not null default true,
  user_ref text,
  login text,
  mobile_access boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collectors_ref_format check (ref ~ '^COB-')
);

create index if not exists collectors_active_idx on public.collectors (active);

drop trigger if exists collectors_set_updated_at on public.collectors;
create trigger collectors_set_updated_at
  before update on public.collectors
  for each row execute function public.set_updated_at();

comment on table public.collectors is 'Cobradores de campo. ref=COB-…';

-- ---------------------------------------------------------------------------
-- ROUTES
-- ---------------------------------------------------------------------------
create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  slug text not null default '',
  name text not null default '',
  collector_ref text not null default '',
  collector_name text not null default '',
  zone text not null default '',
  frequency text not null default '',
  notes text,
  stops jsonb not null default '[]'::jsonb,
  clients_count integer not null default 0,
  status text not null default 'Activa',
  kind text not null default 'ok',
  scheduled_date text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists routes_collector_ref_idx on public.routes (collector_ref);
create index if not exists routes_status_idx on public.routes (status);

drop trigger if exists routes_set_updated_at on public.routes;
create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

comment on table public.routes is 'Rutas permanentes y de despacho diario (RUT- / RUT-D-…).';

-- ---------------------------------------------------------------------------
-- DAY CLOSES (CIE)
-- ---------------------------------------------------------------------------
create table if not exists public.day_closes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  collector_ref text not null,
  collector_name text not null default '',
  close_date date not null,
  route_ref text not null default '',
  collected numeric(14, 2) not null default 0 check (collected >= 0),
  expenses jsonb not null default '[]'::jsonb,
  expenses_total numeric(14, 2) not null default 0 check (expenses_total >= 0),
  cash_float numeric(14, 2) not null default 0,
  closed_at timestamptz not null,
  movement_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint day_closes_ref_format check (ref ~ '^CIE-')
);

create unique index if not exists day_closes_collector_date_uidx
  on public.day_closes (collector_ref, close_date);
create index if not exists day_closes_close_date_idx on public.day_closes (close_date desc);

drop trigger if exists day_closes_set_updated_at on public.day_closes;
create trigger day_closes_set_updated_at
  before update on public.day_closes
  for each row execute function public.set_updated_at();

comment on table public.day_closes is
  'CIE / cierre de jornada. collected se alinea a PG-; cash_float = collected − gastos.';

-- ---------------------------------------------------------------------------
-- DAY EXPENSES (borrador de gastos antes del CIE)
-- ---------------------------------------------------------------------------
create table if not exists public.day_expenses (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  collector_ref text not null,
  collector_name text not null default '',
  expense_date date not null,
  route_ref text not null default '',
  expenses jsonb not null default '[]'::jsonb,
  expenses_total numeric(14, 2) not null default 0 check (expenses_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists day_expenses_collector_date_uidx
  on public.day_expenses (collector_ref, expense_date);

drop trigger if exists day_expenses_set_updated_at on public.day_expenses;
create trigger day_expenses_set_updated_at
  before update on public.day_expenses
  for each row execute function public.set_updated_at();

comment on table public.day_expenses is 'Gastos de ruta durante el día (antes de cerrar CIE).';

-- ---------------------------------------------------------------------------
-- MISC PAYMENTS (PV- oficina)
-- ---------------------------------------------------------------------------
create table if not exists public.misc_payments (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  paid_date text not null,
  label text not null default '',
  amount numeric(14, 2) not null check (amount > 0),
  bank_account_ref text not null default '',
  method text not null default 'efectivo',
  created_at_app text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint misc_payments_ref_format check (ref ~ '^PV-')
);

create index if not exists misc_payments_paid_date_idx on public.misc_payments (paid_date);

drop trigger if exists misc_payments_set_updated_at on public.misc_payments;
create trigger misc_payments_set_updated_at
  before update on public.misc_payments
  for each row execute function public.set_updated_at();

comment on table public.misc_payments is 'Pagos varios de oficina (PV-). Entran al banco como proyección.';

-- ---------------------------------------------------------------------------
-- DAILY ASSIGNMENTS (planilla del día)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_assignments (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  dispatch_date date not null,
  loan_ref text not null default '',
  client_ref text not null default '',
  client_name text not null default '',
  client_route text not null default '',
  address text,
  charge_date text,
  amount_due numeric(14, 2) not null default 0,
  charge_label text not null default '',
  kind text not null default 'cuota',
  collector_ref text not null default '',
  collector_name text not null default '',
  assigned_at text,
  dispatched boolean not null default false,
  dispatched_at text,
  visit_status text,
  skip_reason text,
  day_closed_at text,
  payment_ref text,
  alert_count integer,
  awaiting_loan boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_date, item_id)
);

create index if not exists daily_assignments_collector_date_idx
  on public.daily_assignments (collector_ref, dispatch_date);
create index if not exists daily_assignments_loan_ref_idx
  on public.daily_assignments (loan_ref);

drop trigger if exists daily_assignments_set_updated_at on public.daily_assignments;
create trigger daily_assignments_set_updated_at
  before update on public.daily_assignments
  for each row execute function public.set_updated_at();

comment on table public.daily_assignments is
  'Planilla / visitas del día. visit_status y payment_ref se alinean a PG-.';

-- ---------------------------------------------------------------------------
-- FK físicas: diferidas a C6.1 (tras backfill completo).
-- Hoy dual-write puede llegar desordenado (pago antes que préstamo remoto).
-- Relación lógica: loans.client_ref → clients.ref, payments.loan_ref → loans.ref
-- ---------------------------------------------------------------------------
comment on column public.loans.client_ref is 'FK lógica → clients.ref (COD-…). Física en C6.1';
comment on column public.payments.loan_ref is 'FK lógica → loans.ref (P-…). Física en C6.1';

-- ---------------------------------------------------------------------------
-- RLS homogéneo (anon temporal + authenticated). Quitar anon cuando Auth cubra calle.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'collectors', 'routes', 'day_closes', 'day_expenses',
    'misc_payments', 'daily_assignments'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_anon_c6', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_anon_c6', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_anon_c6', t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_authenticated', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (true)',
      t || '_insert_authenticated', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (true) with check (true)',
      t || '_update_authenticated', t
    );
    execute format(
      'create policy %I on public.%I for select to anon using (true)',
      t || '_select_anon_c6', t
    );
    execute format(
      'create policy %I on public.%I for insert to anon with check (true)',
      t || '_insert_anon_c6', t
    );
    execute format(
      'create policy %I on public.%I for update to anon using (true) with check (true)',
      t || '_update_anon_c6', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Vista maestra del dominio
-- ---------------------------------------------------------------------------
create or replace view public.v_ops_overview as
select
  (select count(*) from public.clients) as clients_count,
  (select count(*) from public.loans) as loans_count,
  (select count(*) from public.payments) as payments_count,
  (select coalesce(sum(amount), 0) from public.payments) as payments_total,
  (select count(*) from public.collectors) as collectors_count,
  (select count(*) from public.routes) as routes_count,
  (select count(*) from public.day_closes) as day_closes_count,
  (select count(*) from public.daily_assignments) as assignments_count;

comment on view public.v_ops_overview is 'Conteo rápido del dominio operativo en Postgres.';
