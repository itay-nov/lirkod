-- 0011 — a picked avatar on profiles, and a column-scoped UPDATE grant to match.
--
-- 0001 is already applied and is not edited here (AGENTS.md §12/§13).
--
-- Phase 4.3 (docs/decisions/0019). Two things, deliberately in one migration
-- because the second only exists to make the first safe.
--
-- ---------------------------------------------------------------------------
-- Part 1 — avatar_id
-- ---------------------------------------------------------------------------
--
-- A closed set of PRESET avatars, not free text and not an upload. There is no
-- storage bucket this phase (the task is explicit about that), and a closed set
-- is also just correct for this feature: the set is curated, small, and drawn
-- entirely from `src/lib/domain/avatar.ts` and the icon components under
-- `src/components/avatars/` — nothing about "which avatar" is data a client
-- should get to invent. An enum is what makes an invented value a rejected
-- INSERT/UPDATE instead of a value the UI has to defend against everywhere it
-- reads one back.
--
-- The twelve labels below must stay byte-for-byte in step with `AVATAR_IDS` in
-- `src/lib/domain/avatar.ts`, which derives its type from this enum via
-- `Database["public"]["Enums"]["avatar_choice"]` — one source of truth, checked
-- by `tests/unit/avatar.test.ts` against the generated types, not duplicated by
-- hand on the TypeScript side.
create type public.avatar_choice as enum (
  'woman_short_hair',
  'man_curly',
  'woman_long_hair',
  'man_glasses',
  'woman_gray_bun',
  'man_bald_mustache',
  'woman_curly_gray',
  'man_gray_beard',
  'dancer_figure',
  'circle_dance',
  'pomegranate',
  'musical_notes'
);

comment on type public.avatar_choice is
  'The closed set of preset profile avatars (Phase 4.3, docs/decisions/0019). Inline SVG, not uploaded — no storage bucket this phase. Must match AVATAR_IDS in src/lib/domain/avatar.ts exactly.';

-- NOT NULL with a default rather than nullable: "no avatar chosen" is not a
-- state this product needs to represent, any more than "no display name" is —
-- everyone gets a sensible default the moment their profile row exists, the
-- same way `profiles.display_name` has never been allowed to be empty.
-- 'pomegranate' is the default: it is the one preset that is neither a face
-- nor gendered, it matches --color-accent's own name in globals.css, and it
-- is a shared, recognisable symbol for this specific community rather than a
-- generic "blank person" placeholder.
--
-- Adding a NOT NULL column with a constant DEFAULT is a metadata-only change on
-- modern Postgres (no table rewrite), so the existing seeded rows in
-- supabase/seed.sql do not need to name a value themselves.
alter table public.profiles
  add column avatar_id public.avatar_choice not null default 'pomegranate';

comment on column public.profiles.avatar_id is
  'One of the closed set of preset avatars (public.avatar_choice). Private, like the rest of profiles — an avatar is shown in the personal area, never on the public map or schedule, which read instructors.display_name only (docs/decisions/0004).';

-- ---------------------------------------------------------------------------
-- Part 2 — tightening the UPDATE grant this column is added to
-- ---------------------------------------------------------------------------
--
-- 0001 granted UPDATE on `profiles` table-wide:
--
--     grant select, insert, update on public.profiles to authenticated;
--
-- and until this phase nothing in the app ever issued a profiles UPDATE at
-- all — `saveProfileName` only INSERTs (confirmed by reading every
-- `.from("profiles")` call site before writing this). So the grant was dead
-- code at the privilege layer: reachable by nothing in this codebase, but
-- still reachable by anyone with a valid session and a PostgREST client,
-- for every column including `phone` and `home_location`.
--
-- This phase is what finally exercises UPDATE on this table, for exactly two
-- columns (`display_name`, the existing rename path now covered by RLS
-- test "lets a user rename themselves"; and `avatar_id`, new here). That is
-- the moment to close the gap rather than build the avatar feature on top of
-- it — the same reasoning migration 0004 already applied to `instructors`,
-- which is why that table's UPDATE grant was column-scoped from day one and
-- this table's was the odd one out.
--
-- Nobody loses anything: `phone` is proved by SMS and must only ever change
-- through a new OTP verification, never a plain field edit, and
-- `home_location` has no write path in this phase either (it is read-only,
-- optional, and set from geolocation — see the column's own comment in 0001).
-- `id` and `created_at` were never meant to be a client's to choose, same
-- reasoning as 0004's note on `instructors.id`.
revoke update on public.profiles from authenticated;

-- Deliberately not `phone`, `home_location`, `id` or `created_at`. Postgres
-- checks privileges before RLS, so an UPDATE naming any of those is refused
-- with 42501 before `profiles_update_own` is ever consulted — the same layered
-- defence 0004 built for `instructors.verified`.
grant update (display_name, avatar_id) on public.profiles to authenticated;
