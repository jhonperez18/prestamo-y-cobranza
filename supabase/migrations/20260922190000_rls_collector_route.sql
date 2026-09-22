-- Cobrador: solo lee e inserta clientes, préstamos y cobros de su id o de su ruta.
-- Admin y supervisor siguen viendo y escribiendo todo.
-- La API con service role no pasa por estas políticas.

alter table public.clients enable row level security;
alter table public.loans enable row level security;
alter table public.payments enable row level security;

create or replace function public.collector_route_match(p_route text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_staff_profile()
    or (
      btrim(coalesce(public.current_collector_ref(), '')) <> ''
      and exists (
        select 1
        from public.routes r
        where r.collector_ref = public.current_collector_ref()
          and (
            btrim(r.name) = btrim(coalesce(p_route, ''))
            or btrim(r.ref) = btrim(coalesce(p_route, ''))
          )
          and btrim(coalesce(p_route, '')) <> ''
      )
    );
$$;

create or replace function public.collector_client_match(p_client_ref text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_staff_profile()
    or exists (
      select 1
      from public.clients c
      where c.ref = p_client_ref
        and public.collector_route_match(c.route)
    );
$$;

comment on function public.collector_route_match(text) is
  'True si el JWT es staff o la ruta pertenece al collector_ref del cobrador.';

comment on function public.collector_client_match(text) is
  'True si el cliente está en una ruta del cobrador (o el JWT es staff).';

-- La política abierta clients_select_auth / loans_select_auth (using true)
-- deja ver toda la cartera. Hay que quitarla: en Postgres las políticas se suman.
drop policy if exists "clients_select_auth" on public.clients;
drop policy if exists "clients_select_authenticated" on public.clients;
drop policy if exists "clients_select_staff_or_route" on public.clients;
drop policy if exists "clients_insert_collector_route" on public.clients;

create policy "clients_select_staff_or_route"
  on public.clients for select to authenticated
  using (public.collector_route_match(route));

create policy "clients_insert_collector_route"
  on public.clients for insert to authenticated
  with check (public.collector_route_match(route));

drop policy if exists "loans_select_auth" on public.loans;
drop policy if exists "loans_select_authenticated" on public.loans;
drop policy if exists "loans_select_staff_or_route" on public.loans;
drop policy if exists "loans_insert_collector_route" on public.loans;

create policy "loans_select_staff_or_route"
  on public.loans for select to authenticated
  using (public.collector_client_match(client_ref));

create policy "loans_insert_collector_route"
  on public.loans for insert to authenticated
  with check (public.collector_client_match(client_ref));

drop policy if exists "payments_select_staff_or_own" on public.payments;
drop policy if exists "payments_select_authenticated" on public.payments;
drop policy if exists "payments_select_staff_or_route" on public.payments;
drop policy if exists "payments_insert_collector_route" on public.payments;

create policy "payments_select_staff_or_route"
  on public.payments for select to authenticated
  using (
    public.is_staff_profile()
    or (
      btrim(coalesce(public.current_collector_ref(), '')) <> ''
      and btrim(coalesce(collector_ref, '')) = btrim(public.current_collector_ref())
    )
    or public.collector_client_match(client_ref)
    or exists (
      select 1
      from public.loans l
      where l.ref = loan_ref
        and public.collector_client_match(l.client_ref)
    )
    or public.collector_route_match(route_ref)
  );

create policy "payments_insert_collector_route"
  on public.payments for insert to authenticated
  with check (
    public.is_staff_profile()
    or (
      btrim(coalesce(public.current_collector_ref(), '')) <> ''
      and btrim(coalesce(collector_ref, '')) = btrim(public.current_collector_ref())
      and (
        public.collector_client_match(client_ref)
        or exists (
          select 1
          from public.loans l
          where l.ref = loan_ref
            and public.collector_client_match(l.client_ref)
        )
        or public.collector_route_match(route_ref)
      )
    )
  );

grant execute on function public.collector_route_match(text) to authenticated;
grant execute on function public.collector_client_match(text) to authenticated;
