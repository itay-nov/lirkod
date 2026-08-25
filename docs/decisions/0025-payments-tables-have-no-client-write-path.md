# 0025 — The payments tables have no client write path, and two SECURITY DEFINER RPCs are the exception

## Status

Accepted.

## Context

Migration 0016 adds the first financial tables in this schema: `orders`, `tickets`,
`punch_cards`, `credits`, `sponsored_promotions`. There is still no payment provider —
that choice is open (AGENTS.md §14) — so this is schema and RLS only.

Every table before this one follows one shape, set by migration 0001: reading is the
product and is open (often to `anon`), writing is gated by an ownership policy —
`owns_instructor`, `owns_event` — over a table-wide grant to `authenticated`. Migration
0012 narrowed the read half for `favorites`, but kept the write half: the owner inserts
and deletes their own rows directly through PostgREST.

That shape does not survive contact with money. AGENTS.md §8 requires that a price, a
user id or a fee amount arriving from a client is never trusted and is re-read on the
server, and that only a verified webhook marks a payment paid. An ownership policy
cannot express either. `favorites_insert_own` is a complete rule because a favorite
carries no value beyond who owns it; an equivalent `orders_insert_own` would let any
signed-in caller POST a paid order for one agora and mint themselves a ticket, and the
policy would be right to allow it — the row does belong to them.

## Decision

**On all five payments tables, `authenticated` holds `SELECT` and nothing else, and
`anon` holds no grant at all.**

There is no INSERT, UPDATE or DELETE policy anywhere in migration 0016. That is not an
omission for a later migration to fill in with a policy; there is no privilege for a
policy to narrow, so a write is refused by Postgres before RLS is consulted. Ordinary
writes come from `service_role` on the server — today by hand, later from the payment
webhook.

Exactly two functions are reachable by a client, and both are `SECURITY DEFINER`:

- `redeem_credit_for_ticket(p_credit_id, p_occurrence_id)`
- `request_credit_refund(p_credit_id)`

**This deliberately inverts migration 0006's choice**, and the inversion is the point.
`publish_dance` is `SECURITY INVOKER` because the tables it writes already carry
ownership policies, so running as the caller lets those policies do the work rather than
a second copy of them drifting out of sync; 0006's own header explains at length why a
definer version would be a hole through every ownership policy in the schema. Here there
are no policies to defer to, by design, so an invoker function would simply fail. The
definer functions are the entire client-reachable write surface, and they carry the
burden that goes with it:

- Neither takes an amount. The price is re-read from `dance_events.price_agorot` and the
  balance from `credits.remaining_agorot` (AGENTS.md §8).
- Every row is fetched with `buyer_id = auth.uid()` in the `WHERE` clause, so someone
  else's credit is *not found* rather than found-and-rejected.
- The credit is taken `FOR UPDATE` before anything is decided, so two concurrent
  redemptions cannot both succeed.
- Expiry is `now() < expires_at`, never `status = 'active'`. Nothing sweeps that column,
  so a stale status must not be spendable.
- `search_path` is pinned to `''`, and `EXECUTE` is revoked from `public`, `anon` and
  (as in 0006) `service_role`.

**Cross-row agreement is enforced by composite foreign keys, not by triggers or
convention.** Each parent carries a redundant `UNIQUE (id, <column that must agree>)` and
each child a composite FK into it, so "a ticket belongs to the same buyer as its order",
"a credit is scoped to the same instructor the order paid", and "a promotion is for a
dance its own instructor runs" are refused by Postgres. This is the same
make-it-unrepresentable move as `event_occurrences_status_matches_override`
(docs/decisions/0003). Only the three rules that depend on another row's *state* — an
entitlement needs a paid order of the matching kind, a ticket's night must belong to the
instructor who was paid, a spent punch card cannot be punched — are left to triggers,
which are `BEFORE INSERT` so that `service_role`, and therefore the future webhook, is
held to them too.

**An instructor cannot read `public.credits`.** They read orders and tickets for their
own dances and their own promotions, all read-only. A credit is a claim the dancer
holds; the instructor's own liability is derivable from the orders they can already see,
so a per-dancer balance sheet would be data stored and exposed for a need nobody has
stated (AGENTS.md §8).

## Consequences

- Any future checkout, refund or payout surface is a server-side path or a new audited
  RPC. There is no "just add an insert policy" option, and adding one would be a
  regression against this ADR, not a feature.
- `orders.buyer_id` is `ON DELETE RESTRICT`, unlike every other reference to
  `auth.users` in this schema. Deleting an account that has ever bought anything now
  fails loudly, so account deletion needs a server-side path that anonymises rather than
  deletes. That path does not exist yet.
- Fixture teardown has to unwind financial rows in dependency order; nothing cascades.
  `tests/rls/payments.test.ts` documents the sequence, including the `orders` ⇄ `credits`
  cycle, which is unwound by deleting the order that spent a credit before the credit.
- The five-per-area cap on sponsored promotions is keyed on a placeholder `text` column
  and is explicitly provisional. When "area" gets a real, probably geographic definition,
  the column and `enforce_sponsored_promotion_area_cap()` are replaced together; nothing
  else depends on the placeholder.
