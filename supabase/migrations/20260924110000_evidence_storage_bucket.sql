-- Bucket privado para firmas / comprobantes.
-- Postgres solo guarda el path (payments/{PG-}/evidence|signatures/{fileId}).
-- Service role sube desde el mirror; no hay acceso público.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table storage.buckets is
  'Buckets de Storage. evidence = constancias de cobro (nunca Base64 en payments).';

-- Lectura/escritura solo con service role (bypass RLS). Sin políticas anon públicas.
drop policy if exists "evidence_select_authenticated" on storage.objects;
drop policy if exists "evidence_insert_authenticated" on storage.objects;
drop policy if exists "evidence_update_authenticated" on storage.objects;
drop policy if exists "evidence_delete_authenticated" on storage.objects;

create policy "evidence_select_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'evidence');

create policy "evidence_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence');

create policy "evidence_update_authenticated"
  on storage.objects for update to authenticated
  using (bucket_id = 'evidence')
  with check (bucket_id = 'evidence');

create policy "evidence_delete_authenticated"
  on storage.objects for delete to authenticated
  using (bucket_id = 'evidence');
