-- =============================================================================
-- Esquema operativo CA préstamo — endurecimiento
-- Tablas canónicas en public: clients → loans → payments
-- Dinero: NUMERIC. Claves de negocio: COD- / P- / PG-
-- Ver: docs/supabase-schema.md
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at automático
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Mantiene updated_at en UTC en cada UPDATE de tablas operativas.';

-- ---------------------------------------------------------------------------
-- CLIENTS (personas de ruta)
-- ---------------------------------------------------------------------------
alter table public.clients
  alter column total type numeric(14, 2),
  alter column pending type numeric(14, 2);

alter table public.clients
  drop constraint if exists clients_total_nonneg,
  drop constraint if exists clients_pending_nonneg,
  drop constraint if exists clients_route_order_nonneg,
  drop constraint if exists clients_ref_format;

alter table public.clients
  add constraint clients_total_nonneg check (total >= 0),
  add constraint clients_pending_nonneg check (pending >= 0),
  add constraint clients_route_order_nonneg check (route_order >= 0),
  add constraint clients_ref_format check (ref ~ '^COD-');

create index if not exists clients_document_idx on public.clients (document);
create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_route_order_idx on public.clients (route, route_order);

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

comment on table public.clients is
  'Raíz de personas. ref=COD-… Una fila = un cliente. Préstamos y cobros apuntan aquí.';
comment on column public.clients.ref is 'Clave de negocio única (COD-8, COD-18, …)';
comment on column public.clients.alta is 'Fecha de alta (texto dd/mm/yyyy del demo; normalizar a date en C6+)';
comment on column public.clients.route is 'Número/nombre de ruta permanente';
comment on column public.clients.route_order is 'Orden en la ruta (1…N)';
comment on column public.clients.total is 'Cupo / total pactado proyectado (NUMERIC)';
comment on column public.clients.pending is 'Saldo pendiente proyectado (NUMERIC)';
comment on column public.clients.awaiting_loan is 'Alta de calle sin préstamo aún';
comment on column public.clients.profile_pending is 'Ficha incompleta; opera pero alerta en oficina';

-- ---------------------------------------------------------------------------
-- LOANS (contratos)
-- ---------------------------------------------------------------------------
alter table public.loans
  drop constraint if exists loans_capital_nonneg,
  drop constraint if exists loans_paid_nonneg,
  drop constraint if exists loans_balance_nonneg,
  drop constraint if exists loans_ref_format,
  drop constraint if exists loans_frequency_ok,
  drop constraint if exists loans_mode_ok,
  drop constraint if exists loans_pact_ok,
  drop constraint if exists loans_alerts_nonneg;

alter table public.loans
  add constraint loans_capital_nonneg check (capital >= 0),
  add constraint loans_paid_nonneg check (paid >= 0),
  add constraint loans_balance_nonneg check (balance >= 0),
  add constraint loans_ref_format check (ref ~ '^P-'),
  add constraint loans_frequency_ok check (
    frequency is null or frequency in ('diario', 'semanal', 'quincenal', 'mensual')
  ),
  add constraint loans_mode_ok check (
    mode is null or mode in ('interes', 'cuota_fija')
  ),
  add constraint loans_pact_ok check (
    pact is null or pact in ('tasa', 'valor')
  ),
  add constraint loans_alerts_nonneg check (collection_alerts >= 0);

create index if not exists loans_status_idx on public.loans (status);
create index if not exists loans_client_status_idx on public.loans (client_ref, status);

drop trigger if exists loans_set_updated_at on public.loans;
create trigger loans_set_updated_at
  before update on public.loans
  for each row execute function public.set_updated_at();

comment on table public.loans is
  'Raíz de contratos. ref=P-… Condiciones históricas; paid/balance se re-proyectan desde payments.';
comment on column public.loans.ref is 'Clave de negocio única (P-1, P-9, …)';
comment on column public.loans.client_ref is 'FK lógica → clients.ref (COD-…)';
comment on column public.loans.client_name is 'Denormalizado para listados; no sustituye clients';
comment on column public.loans.start_date is 'Inicio del préstamo (texto demo; date en C6+)';
comment on column public.loans.due_date is 'Vencimiento pactado';
comment on column public.loans.capital is 'Capital desembolsado (NUMERIC)';
comment on column public.loans.paid is 'Pagado acumulado (proyección desde PG-)';
comment on column public.loans.balance is 'Saldo (proyección)';
comment on column public.loans.schedule is 'Cronograma JSON [{date, amount, kind, paid}]';
comment on column public.loans.collection_alerts is 'Días hábiles seguidos sin pago (0–3 alerta, 4+ mora)';

-- ---------------------------------------------------------------------------
-- PAYMENTS (cobros = raíz de plata)
-- ---------------------------------------------------------------------------
alter table public.payments
  drop constraint if exists payments_ref_format,
  drop constraint if exists payments_method_ok,
  drop constraint if exists payments_source_ok;

alter table public.payments
  add constraint payments_ref_format check (ref ~ '^PG-'),
  add constraint payments_method_ok check (method in ('efectivo', 'nequi')),
  add constraint payments_source_ok check (
    source in ('ruta', 'pwa', 'caja', 'oficina')
  );

create index if not exists payments_client_ref_idx on public.payments (client_ref);
create index if not exists payments_updated_at_idx on public.payments (updated_at desc);
create index if not exists payments_loan_paid_date_idx on public.payments (loan_ref, paid_date desc);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

comment on table public.payments is
  'RAÍZ DE DINERO. ref=PG-… Planilla, CIE y banco se proyectan desde aquí. Nunca float.';
comment on column public.payments.ref is 'Clave de negocio única / idempotencia (PG-…)';
comment on column public.payments.loan_ref is 'FK lógica → loans.ref (P-…)';
comment on column public.payments.client_ref is 'FK lógica → clients.ref (opcional pero recomendado)';
comment on column public.payments.amount is 'Monto cobrado NUMERIC(14,2) > 0';
comment on column public.payments.paid_date is 'Fecha operativa del cobro (date)';
comment on column public.payments.method is 'efectivo | nequi';
comment on column public.payments.source is 'ruta|pwa|caja|oficina';

-- ---------------------------------------------------------------------------
-- Vistas de lectura (claro, manejable, sin duplicar datos)
-- ---------------------------------------------------------------------------
create or replace view public.v_loans_enriched as
select
  l.ref as loan_ref,
  l.client_ref,
  l.client_name,
  l.start_date,
  l.due_date,
  l.capital,
  l.paid,
  l.balance,
  l.status as loan_status,
  l.frequency,
  l.mode,
  l.installment,
  l.collection_alerts,
  l.terms_pending,
  c.name as client_first_name,
  c.last_name as client_last_name,
  c.route,
  c.route_order,
  c.phone as client_phone,
  c.status as client_status,
  l.updated_at as loan_updated_at
from public.loans l
left join public.clients c on c.ref = l.client_ref;

comment on view public.v_loans_enriched is
  'Préstamo + cliente de ruta. Solo lectura para reportes / soporte.';

create or replace view public.v_payments_enriched as
select
  p.ref as payment_ref,
  p.loan_ref,
  p.client_ref,
  coalesce(p.client_ref, l.client_ref) as resolved_client_ref,
  p.amount,
  p.paid_date,
  p.paid_time,
  p.method,
  p.source,
  p.collector_ref,
  p.collector_name,
  p.route_ref,
  l.client_name as loan_client_name,
  l.balance as loan_balance,
  c.route as client_route,
  p.created_at,
  p.updated_at
from public.payments p
left join public.loans l on l.ref = p.loan_ref
left join public.clients c on c.ref = coalesce(p.client_ref, l.client_ref);

comment on view public.v_payments_enriched is
  'Cobro + préstamo + cliente. Vista de conciliación; la raíz sigue siendo payments.';

-- ---------------------------------------------------------------------------
-- Relación lógica documentada (FK física diferida a C6 cuando el catálogo
-- esté 100% en Postgres; hoy dual-write puede llegar desordenado).
-- ---------------------------------------------------------------------------
comment on constraint loans_ref_format on public.loans is 'Negocio: P-…';
comment on constraint payments_ref_format on public.payments is 'Negocio: PG-…';
comment on constraint clients_ref_format on public.clients is 'Negocio: COD-…';
