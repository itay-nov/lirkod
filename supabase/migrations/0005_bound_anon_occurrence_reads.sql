-- 0005 — put a time horizon on the anonymous read of event_occurrences.
--
-- 0001 is already applied and is not edited here (AGENTS.md §12 / §13).
--
-- The gap: migration 0003 bounded find_dances_near (50km radius, 60-day horizon,
-- 200 rows), but that RPC is not the only way to the data. `anon` holds a plain
-- SELECT privilege on event_occurrences, dance_events and venues, and 0001's
-- policies read `using (true)`, so `GET /rest/v1/event_occurrences?select=*`
-- returns the table with none of those bounds applied. The RPC's limits were a
-- front door on a building with the side door propped open.
--
-- What this migration does NOT do: add `security definer` to find_dances_near, or
-- take the raw SELECT away. Both are ruled out — docs/decisions/0005 keeps the RPC
-- running as the caller so it can only reach what RLS already allows `anon`, and
-- AGENTS.md §2.2 forbids gating reads. The reasoning, and the parity this cannot
-- reach, is docs/decisions/0010.
--
-- What it does: bound the anonymous read on the one axis RLS can express without a
-- parameter. Radius needs a query point, which a policy has no way to receive; time
-- needs nothing but now(). So the window below mirrors the RPC's 60-day horizon.
--
-- The window is closed at both ends on purpose. The forward bound is the RPC's;
-- the backward one matters just as much, because past occurrences accumulate
-- forever — a policy open at that end would let the anonymous read grow without
-- limit as the product ages, which is the same unbounded result set 0003 set out
-- to prevent, only arriving slowly.
--
-- The one-day grace on the past end, rather than the RPC's `starts_at >= now()`:
-- a dance that began at 20:00 is still on at 21:00, and a policy cutting at now()
-- would make tonight's row vanish from an anonymous read mid-evening — including
-- its "בוטל"/"הועבר" status, which AGENTS.md §10 makes the one thing that must
-- always reach a dancer. A day also keeps last night readable, which is what a
-- visitor checking "was it cancelled?" the morning after actually wants.
--
-- `authenticated` keeps the unbounded read, as a separate policy. Two reasons: an
-- instructor has to be able to see their own past nights, and a session here costs
-- a real phone number and an SMS OTP (AGENTS.md §2.3), which is a bound of a
-- different kind — unlike the anon key, which ships in the JavaScript bundle and
-- is public by construction.
--
-- find_dances_near is unaffected: its own filter (`starts_at >= now()` and
-- `< now() + 60 days`) sits strictly inside this window, so the same rows come back.

drop policy "event_occurrences_select_public" on public.event_occurrences;

-- Allows: anyone, with no account, to read every occurrence in the window this
-- product is about — including cancelled and moved ones. A dancer must be able to
-- see "בוטל" without logging in; hiding a cancelled row would send them out to a
-- hall that is dark (AGENTS.md §10).
-- Denies: nothing within the window. Outside it, the row is simply not there —
-- which is a bound on bulk extraction, not on any read the product performs.
--
-- starts_at is indexed (event_occurrences_starts_at_idx), so this stays a range
-- scan rather than turning every anonymous read into a seq scan.
create policy "event_occurrences_select_anon_horizon"
  on public.event_occurrences for select
  to anon
  using (
    starts_at >= now() - interval '1 day'
    and starts_at < now() + interval '60 days'
  );

-- Allows: a signed-in user to read every occurrence, past included. An instructor
-- needs their own history, and reaching this role costs a phone-OTP sign-in.
-- Denies: nothing on read.
create policy "event_occurrences_select_authenticated"
  on public.event_occurrences for select
  to authenticated
  using (true);
