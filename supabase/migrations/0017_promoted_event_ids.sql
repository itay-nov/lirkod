-- 0017 — the one sanctioned read out of the payments schema.
--
-- 0016 is already applied and is not edited here (AGENTS.md §12 / §13).
--
-- WHAT THIS IS FOR. A paid sponsored promotion should nudge its dance up the
-- public schedule. The schedule is anonymous (AGENTS.md §2.1, §2.2), and
-- `public.sponsored_promotions` is readable by nobody but the instructor who
-- owns the row — no anon grant, no authenticated grant beyond ownership
-- (migration 0016). So the schedule cannot read the table, and must not be
-- given a way to.
--
-- This function is the narrow window instead. It answers exactly one question,
-- "which dances are promoted right now", and returns exactly one column to
-- answer it.
--
-- ---------------------------------------------------------------------------
-- Why SECURITY DEFINER here, when 0016 uses it for only two functions
-- ---------------------------------------------------------------------------
--
-- docs/decisions/0025 sets the rule: the payments tables have no client grant,
-- so a SECURITY INVOKER function over them would simply fail, and every definer
-- function is a deliberate, audited hole. 0016 opened two, both writes
-- (redeem_credit_for_ticket, request_credit_refund). This is the third and the
-- first READ, and docs/decisions/0026 records why it is allowed.
--
-- The properties that make it safe are the same ones 0016's header lists, minus
-- the ones a read does not need:
--
--   * `language sql` with a single SELECT. Not plpgsql, so there is no
--     statement list a future edit can quietly extend into a write, and no
--     dynamic SQL. It is `stable`, which Postgres itself enforces against
--     writes.
--   * ONE output column, `event_id`. Not "select a few safe columns from a
--     wide row" — the RETURNS TABLE is the allowlist, and it names one thing.
--     No price, no order id, no buyer, no instructor, no payout, no fee, no
--     window, no area. Adding a column here is a schema change with a diff,
--     which is the point.
--   * The returned ids are ALREADY public. `dance_events_select_public`
--     (migration 0001) is `using (true)` and `anon` holds SELECT on the table,
--     so every uuid this can emit is one an anonymous caller can already read
--     straight from PostgREST. The genuinely new fact disclosed is one bit per
--     public dance: promoted, or not. That bit is the feature.
--   * `search_path` is pinned to '' so nothing here can be captured by a
--     caller's, and every reference is schema-qualified.
--   * A row cap, so one call cannot be made arbitrarily expensive.
--
-- ---------------------------------------------------------------------------
-- PAID, not merely live — deliberately stricter than the cap
-- ---------------------------------------------------------------------------
--
-- 0016's enforce_sponsored_promotion_area_cap() counts a promotion whose order
-- is still `pending_provider_confirmation`. That is right for the CAP: a
-- promotion holds its area slot from checkout so a slot cannot be sold twice
-- while the provider is deciding.
--
-- It would be wrong here. A slot reservation is not a purchase, and sort
-- position is the thing being bought. If a pending order earned the boost, the
-- boost would be free — start a checkout, never finish it, keep the placement.
-- So this requires `o.status = 'paid'`, which under 0016's
-- orders_paid_needs_provider_reference means a webhook confirmed it (AGENTS.md
-- §8) — the one exception being an order fully covered by credit, which
-- sponsored promotions cannot use at all
-- (orders_sponsored_promotion_takes_no_credit).
--
-- The reservation and the benefit are different questions, and this is the
-- second one.
--
-- ---------------------------------------------------------------------------
-- `p_area` matches 0016's area exactly, and defaults to "any"
-- ---------------------------------------------------------------------------
--
-- 0016's area is free text compared with `=` (see its cap trigger:
-- `where p.area = new.area`), trimmed and length-checked on the way in. This
-- reuses that comparison verbatim rather than introducing a second notion of
-- what an area is — no normalisation, no ILIKE, no prefix match.
--
-- It defaults to NULL, meaning "every area", and NULL is what the only caller
-- passes today. That is not laziness: nothing on the read side HAS an area
-- string. `public.venues` carries name, address, place_id and a geography
-- point, and no area or city column; the schedule asks by (lat, lng, radius)
-- and never by area. Inventing a derivation — parsing a city out of a free-text
-- address, say — would be inventing the very area model 0016 marked as
-- provisional and deferred. The parameter is kept because it is the seam the
-- geographic redesign will use, and because the cap it mirrors is per-area.
--
-- Note for whoever does that redesign: while `p_area` is grantable to `anon`, a
-- caller can probe area strings and learn how the promoted set partitions
-- across them. Today that discloses only "these already-public dances are
-- promoted, and they are in the same area bucket". If area ever becomes
-- commercially sensitive, drop the parameter from the anon grant rather than
-- widening it.

create or replace function public.get_active_promoted_event_ids(p_area text default null)
returns table (event_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.event_id
  from public.sponsored_promotions p
  join public.orders o on o.id = p.order_id
  where p.cancelled_at is null
    and o.status = 'paid'
    and now() >= p.starts_at
    and now() < p.ends_at
    and (p_area is null or p.area = p_area)
  order by p.event_id
  -- 0016 caps promotions at five per area, so a realistic result is single
  -- digits and this never truncates in practice. It is here so that the size of
  -- the answer stays a property of this function rather than of how many
  -- promotions somebody has sold — the same reason find_dances_near carries a
  -- 200-row cap (migration 0003) even though no real query approaches it.
  -- Ordered by id first, so truncation is at least deterministic.
  limit 200;
$$;

comment on function public.get_active_promoted_event_ids(text) is
  'The only read out of the payments schema reachable without a session (docs/decisions/0026). Returns event ids of promotions that are PAID, not cancelled, and inside their active window — one column, nothing commercial. p_area matches migration 0016''s free-text area with `=`; NULL means every area, which is what the schedule passes because nothing on the read side has an area string.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC, which is not what "narrow window"
-- means. Revoked and re-granted explicitly, exactly as 0006 and 0016 do.
--
-- service_role is inside PUBLIC and loses it too, deliberately and for 0006's
-- reason: it bypasses RLS, so a server-side caller holding it should read
-- public.sponsored_promotions directly, where the fact that it is reading
-- commercial data is visible at the call site instead of hidden behind a
-- function named for the schedule.
revoke all on function public.get_active_promoted_event_ids(text) from public, anon;

-- anon AND authenticated: the schedule is the same page either way, and
-- AGENTS.md §2.2 forbids making a read depend on having an account.
grant execute on function public.get_active_promoted_event_ids(text) to anon, authenticated;
