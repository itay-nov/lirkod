-- 0014 — optional public flyer images for dances.
--
-- The bucket is part of the migration rather than a dashboard prerequisite:
-- Supabase documents storage.buckets as the SQL creation surface, and keeping
-- it here makes local resets and hosted deployment apply the same limits.

alter table public.dance_events
  add column flyer_path text,
  add constraint dance_events_flyer_path_matches_event
    check (flyer_path is null or flyer_path like id::text || '/flyer-%');

comment on column public.dance_events.flyer_path is
  'Optional object path in the public dance-flyers bucket. The <event-id>/flyer-<version> shape lets Storage RLS derive ownership and gives every replacement a cache-safe URL.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dance-flyers',
  'dance-flyers',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public buckets serve object GETs without a SELECT policy. We deliberately do
-- not grant anon a metadata/listing policy: flyers follow dance_events' public
-- read model while anonymous callers still get no Storage write capability.
-- A list request may therefore succeed with an empty result rather than an
-- authorization error; the important boundary is that it exposes no rows.

create policy dance_flyers_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dance-flyers'
  and name like (storage.foldername(name))[1] || '/flyer-%'
  and exists (
    select 1
    from public.dance_events event
    where event.id::text = (storage.foldername(name))[1]
      and public.owns_event(event.id)
  )
);

-- Upsert needs SELECT and UPDATE in addition to INSERT. These policies expose
-- only an instructor's own versioned flyer objects, never another dance's metadata.
create policy dance_flyers_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dance-flyers'
  and name like (storage.foldername(name))[1] || '/flyer-%'
  and exists (
    select 1
    from public.dance_events event
    where event.id::text = (storage.foldername(name))[1]
      and public.owns_event(event.id)
  )
);

create policy dance_flyers_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'dance-flyers'
  and name like (storage.foldername(name))[1] || '/flyer-%'
  and exists (
    select 1
    from public.dance_events event
    where event.id::text = (storage.foldername(name))[1]
      and public.owns_event(event.id)
  )
)
with check (
  bucket_id = 'dance-flyers'
  and name like (storage.foldername(name))[1] || '/flyer-%'
  and exists (
    select 1
    from public.dance_events event
    where event.id::text = (storage.foldername(name))[1]
      and public.owns_event(event.id)
  )
);

create policy dance_flyers_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'dance-flyers'
  and name like (storage.foldername(name))[1] || '/flyer-%'
  and exists (
    select 1
    from public.dance_events event
    where event.id::text = (storage.foldername(name))[1]
      and public.owns_event(event.id)
  )
);
