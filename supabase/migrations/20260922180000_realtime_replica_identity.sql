-- El DELETE del canal en vivo tiene que traer el ref, no solo el uuid.
alter table public.clients replica identity full;
alter table public.loans replica identity full;
alter table public.payments replica identity full;
