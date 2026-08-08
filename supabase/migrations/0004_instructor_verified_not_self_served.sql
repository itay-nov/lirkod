-- 0004 — close the self-verification hole on instructors INSERT.
--
-- 0001 is already applied and is not edited here (AGENTS.md §12 / §13).
--
-- The gap: 0001 withheld `verified` from the UPDATE grant
--
--     grant update (display_name, bio) on public.instructors to authenticated;
--
-- but granted INSERT table-wide
--
--     grant select, insert on public.instructors to authenticated;
--
-- and a table-wide INSERT grant covers every column, `verified` included. So the
-- column that 0001's own comment calls "set by us, never self-served" was in fact
-- self-servable — not by editing it afterwards, but by supplying it on the way in.
-- Any signed-in user creating their own instructor row could send verified = true
-- and land a trust badge next to their dances on the public map. Confirmed against
-- the local stack before this migration, from a real phone-OTP session: the insert
-- succeeded and the row came back verified.
--
-- Two layers, because the privilege alone would be one careless `grant insert on
-- public.instructors` away from reopening:
--
--   1. Column-level INSERT. `id` and `created_at` are withheld along with
--      `verified` — both have defaults and neither is a client's to choose.
--   2. `verified = false` in the insert policy's WITH CHECK, so the rule survives
--      a future grant that is written table-wide by habit.
--
-- Rejecting rather than silently coercing to false: a client that sends
-- verified = true is either a bug or an attempt, and both are worth surfacing.
-- Quietly rewriting the value would make an attempt indistinguishable from a
-- normal insert in the logs, and would leave an app bug shipping unnoticed. It
-- also keeps INSERT consistent with UPDATE, which already errors on `verified`
-- (42501) rather than ignoring it — one column, one answer, whichever way a
-- caller reaches for it.
--
-- Promoting an instructor to verified stays a service_role operation. service_role
-- keeps its table-wide grant and bypasses RLS, so nothing here constrains it.

revoke insert on public.instructors from authenticated;

-- Deliberately not `verified`, `id` or `created_at`. Postgres checks privileges
-- before RLS, so an insert naming any of those is refused with 42501 before a
-- policy is consulted.
grant insert (profile_id, display_name, bio) on public.instructors to authenticated;

drop policy "instructors_insert_own" on public.instructors;

-- Allows: a signed-in user to claim one instructor row for their own profile,
-- unverified.
-- Denies: creating an instructor row that points at somebody else's profile, and
-- creating one that arrives already verified.
create policy "instructors_insert_own"
  on public.instructors for insert
  to authenticated
  with check (
    (select auth.uid()) = profile_id
    and verified = false
  );

comment on column public.instructors.verified is
  'Trust flag set by us, never self-served. Held down on both write paths: the column is outside the INSERT and UPDATE grants (migration 0004), and the insert policy additionally requires verified = false so a future table-wide grant cannot silently reopen it. Promotion is a service_role operation.';
