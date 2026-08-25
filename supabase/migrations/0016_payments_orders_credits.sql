-- 0016 — payments groundwork: orders, entitlements (tickets / punch cards),
-- instructor-scoped credits, and sponsored promotions.
--
-- 0001–0015 are already applied and are not edited here (AGENTS.md §12 / §13).
--
-- WHAT THIS MIGRATION IS. Schema and RLS only. There is no payment provider yet
-- — the choice is still open (AGENTS.md §14) — so nothing here calls a gateway,
-- verifies a webhook signature, or moves money. What it does do is give those
-- future things a place to write, and make the rules that money depends on
-- properties of the database rather than of whichever caller happens to be
-- correct that day.
--
-- Every TODO(payments-provider) marker below is a spot the integration
-- migration has to fill in. They are deliberate holes, not omissions.
--
-- ---------------------------------------------------------------------------
-- The shape, in one paragraph
-- ---------------------------------------------------------------------------
--
--   orders                 one purchase. Records what the buyer pays, what the
--                          platform keeps, and what the instructor is owed.
--   tickets                entitlement to ONE night. Comes either from an order
--                          (a single ticket) or from a punch card (one punch).
--   punch_cards            entitlement to N nights of one instructor.
--   credits                what a buyer gets when an instructor cancels a night:
--                          money redeemable only against THAT instructor, for 90
--                          days, after which a cash refund may be requested.
--   sponsored_promotions   an instructor paying the platform to promote a dance.
--                          Not a split payment — the platform is the payee.
--
-- ---------------------------------------------------------------------------
-- The security stance: nobody writes money from a client. Ever.
-- ---------------------------------------------------------------------------
--
-- Every other table in this schema follows "read is the product, writes are
-- gated by ownership" (migration 0001). These tables do not, and the difference
-- is deliberate.
--
-- `authenticated` gets SELECT and NOTHING ELSE on all five tables. There is no
-- INSERT policy on any of them, because there is no INSERT privilege to narrow.
-- A signed-in user holding their own token and posting straight to PostgREST —
-- which is the threat model this project has written policies against since
-- migration 0001, and which AGENTS.md §8 makes explicit ("never trust a price, a
-- user id, or a fee amount that arrived from the client") — cannot create an
-- order, mint a ticket, top up a punch card, or issue themselves a credit. The
-- privilege layer refuses before RLS is even consulted.
--
-- That leaves exactly two client-reachable write paths, both SECURITY DEFINER
-- functions at the bottom of this file, both of which re-read every number they
-- act on out of the database:
--
--   public.redeem_credit_for_ticket()  spend a credit on a night
--   public.request_credit_refund()     ask for cash back on an expired credit
--
-- Everything else is written by `service_role` from the server — today by hand,
-- tomorrow by the payment webhook, which AGENTS.md §8 makes the only thing
-- allowed to mark an order paid.
--
-- `anon` gets nothing at all. Not a narrowed policy, not a time-bounded window
-- like migration 0005 gave occurrence reads — no grant on any of these tables,
-- so an anonymous request is refused at the privilege layer. Unlike the map,
-- none of this is public data.
--
-- ---------------------------------------------------------------------------
-- Why so many composite UNIQUE / FOREIGN KEY pairs
-- ---------------------------------------------------------------------------
--
-- A ticket must belong to the same buyer as the order that paid for it. A credit
-- must be scoped to the same instructor as the order it came from. A promotion
-- must be for a dance its own instructor actually runs. Each of those is a
-- sentence a trigger could enforce, or a comment a future writer could forget.
--
-- Instead each parent table carries a redundant UNIQUE on (id, <the column that
-- must agree>), and each child carries a composite FOREIGN KEY into it. Postgres
-- then refuses the mismatched row itself — the same "make it unrepresentable"
-- move migration 0001 makes with event_occurrences' status/override_venue_id
-- check. The UNIQUEs look pointless next to a primary key; they are load-bearing.
--
-- These use the default MATCH SIMPLE, so a composite FK with a NULL in it is not
-- enforced. That is what makes tickets' two mutually exclusive sources work: a
-- ticket from an order has punch_card_id NULL and only the order-side FK bites.
--
-- ---------------------------------------------------------------------------
-- Currency
-- ---------------------------------------------------------------------------
--
-- ILS only, Israel only. There is no currency column and there should not be one
-- until there is a second currency to name. Every *_agorot column is an integer
-- number of agorot (AGENTS.md §7) — never shekels, never a float, formatted for
-- display only at the edge.

-- ---------------------------------------------------------------------------
-- Enums
--
-- English identifiers, Hebrew labels in src/lib/i18n/he.ts — the convention
-- public.occurrence_status (0001), public.avatar_choice (0011) and
-- public.dance_level (0013) already follow.
-- ---------------------------------------------------------------------------

create type public.order_kind as enum ('ticket', 'punch_card', 'sponsored_promotion');

comment on type public.order_kind is
  'The three purchasable things. ticket and punch_card are marketplace sales — the buyer is a dancer, the instructor is the payee, the platform takes a cut. sponsored_promotion is the odd one out: the instructor is the BUYER and the platform is the payee, so there is no split and no instructor payout (enforced by orders_sponsored_promotion_has_no_payout below).';

create type public.order_status as enum (
  'pending_provider_confirmation',
  'paid',
  'failed',
  'cancelled',
  'refunded'
);

comment on type public.order_status is
  'pending_provider_confirmation is the state an order is born in whenever real money has to move. Only the payment webhook may move it to paid (AGENTS.md §8) — a buyer landing on a success URL proves nothing. The one exception is an order fully covered by credit, which needs no provider and is born paid; the orders_paid_needs_provider_reference check is what holds that line.';

create type public.ticket_status as enum ('valid', 'used', 'cancelled', 'credited');

comment on type public.ticket_status is
  'credited means the instructor cancelled the night and the buyer was issued a credit against this ticket (see public.credits). There is deliberately no no_show value: a no-show is a valid ticket whose night has passed without being used, and the confirmed policy is that it earns neither refund nor credit — so it is the absence of a state change, not a state.';

create type public.punch_card_status as enum ('active', 'exhausted', 'expired', 'cancelled');

create type public.credit_status as enum ('active', 'redeemed', 'expired', 'refunded');

comment on type public.credit_status is
  'refunded means the cash refund a buyer may request after the 90 days have run out was actually paid. NOTE: this column is NOT what makes a credit unspendable once it is past expires_at — nothing sweeps it, so a stale ''active'' row would otherwise be spendable forever. Expiry is enforced by comparing now() to expires_at in redeem_credit_for_ticket(). Never gate money on this column alone.';

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
--
-- One row per purchase, one purchasable per row. There is no order_items table
-- and no quantity column: buying two tickets for the same night is two ticket
-- rows against one order, and a cart holding several different things is a
-- shape no screen in this product asks for yet (AGENTS.md §13 — do not invent
-- product requirements).
--
-- ON DELETE RESTRICT on buyer_id, not CASCADE. Everywhere else in this schema a
-- deleted auth user takes their rows with them (profiles in 0001, favorites in
-- 0012). Financial records are different: they are the other side of a
-- transaction someone else was party to, and Israeli bookkeeping rules require
-- keeping them for years. So deleting an auth user who has ever ordered
-- anything fails loudly rather than erasing the record. That is a real
-- consequence — account deletion needs a server-side path that anonymises
-- rather than deletes — and it is flagged, not hidden.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete restrict,
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  kind public.order_kind not null,
  status public.order_status not null default 'pending_provider_confirmation',

  -- Money. All integers, all agorot, all ILS (AGENTS.md §7).
  --
  --   gross            what the purchase is worth — the list price.
  --   credit_applied   how much of the gross a credit covered.
  --   charged          what a payment provider will actually take from a card.
  --   platform_fee     what the platform keeps.
  --   provider_fee     what the payment provider charges us for the charge.
  --   instructor_payout what the instructor is owed for this order.
  --
  -- Payout is computed from the GROSS, not from the charged amount, and that is
  -- the whole point of splitting the two. A ticket bought entirely with credit
  -- charges a card nothing, but the instructor still ran the dance and is still
  -- owed for it — the money was collected on the earlier order the credit came
  -- out of. Deriving payout from `charged` would silently pay them zero.
  gross_amount_agorot integer not null check (gross_amount_agorot >= 0),
  credit_applied_agorot integer not null default 0 check (credit_applied_agorot >= 0),
  charged_amount_agorot integer
    generated always as (gross_amount_agorot - credit_applied_agorot) stored,
  platform_fee_agorot integer not null default 0 check (platform_fee_agorot >= 0),
  provider_fee_agorot integer not null default 0 check (provider_fee_agorot >= 0),
  instructor_payout_agorot integer
    generated always as (gross_amount_agorot - platform_fee_agorot - provider_fee_agorot) stored,

  -- The credit spent on this order, if any. Also constrained, via the composite
  -- FK below, to belong to this same buyer AND this same instructor — a credit
  -- is scoped to one instructor and that scope is the entire product rule.
  -- Added by an ALTER further down, because public.credits does not exist yet.
  applied_credit_id uuid,

  -- TODO(payments-provider): the integration migration fills these in from the
  -- webhook, and must also decide where the RAW webhook payload is stored
  -- (AGENTS.md §8 requires keeping it) — most likely its own append-only
  -- payment_webhook_events table rather than a jsonb column here, so that a
  -- replayed or unmatched callback still leaves a trace.
  provider_transaction_id text
    check (provider_transaction_id is null or length(btrim(provider_transaction_id)) > 0),
  provider_confirmed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint orders_credit_within_gross
    check (credit_applied_agorot <= gross_amount_agorot),

  constraint orders_fees_within_gross
    check (platform_fee_agorot + provider_fee_agorot <= gross_amount_agorot),

  -- A sponsored promotion is the instructor paying the platform. Nothing is
  -- owed back to them, so the fees must account for the entire gross.
  constraint orders_sponsored_promotion_has_no_payout
    check (
      kind <> 'sponsored_promotion'
      or platform_fee_agorot + provider_fee_agorot = gross_amount_agorot
    ),

  -- Credits are a dancer's claim against an instructor. An instructor buying
  -- promotion from the platform is a different pair of parties entirely and
  -- cannot settle it with one.
  constraint orders_sponsored_promotion_takes_no_credit
    check (kind <> 'sponsored_promotion' or credit_applied_agorot = 0),

  constraint orders_credit_reference_matches_amount
    check ((applied_credit_id is null) = (credit_applied_agorot = 0)),

  -- AGENTS.md §8: the webhook is the only thing that marks a payment as paid.
  -- This is the table-level half of that rule — an order cannot claim to be paid
  -- without a provider transaction id to point at. The escape hatch is an order
  -- the provider was never involved in, because credit covered all of it (which
  -- includes a genuinely free dance, where gross and credit_applied are both 0).
  constraint orders_paid_needs_provider_reference
    check (
      status <> 'paid'
      or provider_transaction_id is not null
      or credit_applied_agorot = gross_amount_agorot
    ),

  constraint orders_confirmation_needs_provider_reference
    check (provider_confirmed_at is null or provider_transaction_id is not null),

  -- Load-bearing despite the primary key. See this migration's header: these are
  -- what the children's composite foreign keys point at.
  constraint orders_id_buyer_id_key unique (id, buyer_id),
  constraint orders_id_instructor_id_key unique (id, instructor_id)
);

comment on table public.orders is
  'One purchase. No anon access and no client write path at all — `authenticated` holds SELECT only, and every insert comes from service_role or from this migration''s two SECURITY DEFINER RPCs. See the migration header for the full stance.';

comment on column public.orders.instructor_id is
  'The counterparty, whichever side of the transaction they are on: the PAYEE for a ticket or punch card, the PAYER for a sponsored promotion.';

comment on column public.orders.instructor_payout_agorot is
  'What the instructor is owed for this order. Generated, so it cannot drift from the numbers it is derived from. There is no payouts table yet — actually moving this money is the payment provider''s job and out of scope (TODO(payments-provider)); this column exists so that when there is one, it has something to read.';

comment on column public.orders.provider_fee_agorot is
  'What the payment provider charged US to take this money. Recorded per order and not just aggregated, because the confirmed refund policy needs it per order: when a buyer cashes out an expired credit, the instructor absorbs the ORIGINAL processing fee, which is this column on the order public.credits.source_order_id points at.';

comment on column public.orders.charged_amount_agorot is
  'What a provider will actually take from a card: gross minus whatever credit covered. Zero means no provider is involved in this order at all.';

comment on column public.orders.provider_transaction_id is
  'TODO(payments-provider). The gateway''s own id for this charge, and the idempotency key AGENTS.md §8 requires a webhook to dedupe on — orders_provider_transaction_id_key below makes a replayed callback a unique violation rather than a second charge.';

-- ---------------------------------------------------------------------------
-- punch_cards — multi-use entitlement, scoped to one instructor
-- ---------------------------------------------------------------------------
--
-- Scoped to an INSTRUCTOR, not to a dance_event, mirroring credits — which the
-- product decisions do pin to an instructor. Whether a punch card should instead
-- be sellable against one specific dance is a real product question and is NOT
-- decided here; it is flagged in this task's summary rather than guessed at.
--
-- remaining_uses is maintained by the database, not by its callers: the
-- consume_punch_card_use trigger on public.tickets below is the only thing that
-- decrements it, and it refuses to punch a card with nothing left. There is no
-- UPDATE grant on this table for anyone but service_role, so the counter cannot
-- be edited around.
create table public.punch_cards (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  buyer_id uuid not null references auth.users (id) on delete restrict,
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  total_uses integer not null check (total_uses > 0),
  remaining_uses integer not null check (remaining_uses >= 0),
  status public.punch_card_status not null default 'active',
  issued_at timestamptz not null default now(),
  -- Nullable, and null means "no expiry". There is no confirmed expiry policy
  -- for punch cards the way there is the 90-day one for credits, so this records
  -- an expiry when a future decision sets one and asserts nothing meanwhile.
  expires_at timestamptz,

  constraint punch_cards_remaining_within_total
    check (remaining_uses <= total_uses),
  constraint punch_cards_expiry_after_issue
    check (expires_at is null or expires_at > issued_at),
  constraint punch_cards_exhausted_means_empty
    check (status <> 'exhausted' or remaining_uses = 0),
  constraint punch_cards_active_means_usable
    check (status <> 'active' or remaining_uses > 0),

  constraint punch_cards_id_buyer_id_key unique (id, buyer_id),

  -- The card belongs to the person who paid for it, and to the instructor the
  -- order named. Neither can be rewritten independently of the order.
  constraint punch_cards_order_buyer_fkey
    foreign key (order_id, buyer_id) references public.orders (id, buyer_id),
  constraint punch_cards_order_instructor_fkey
    foreign key (order_id, instructor_id) references public.orders (id, instructor_id)
);

comment on table public.punch_cards is
  'A multi-use entitlement (כרטיסייה / מנוי) against one instructor. Punching it produces a public.tickets row; the counter is decremented by the consume_punch_card_use trigger, never by a caller.';

comment on column public.punch_cards.remaining_uses is
  'Maintained by the database. INVARIANT: total_uses - remaining_uses equals the number of tickets sourced from this card. Held up by the consume_punch_card_use trigger plus the absence of any UPDATE grant outside service_role.';

-- ---------------------------------------------------------------------------
-- tickets — entitlement to one night
-- ---------------------------------------------------------------------------
--
-- A ticket has exactly one source: an order (someone bought this one night) or a
-- punch card (someone spent one of their punches on it). Never both, never
-- neither — tickets_exactly_one_source.
--
-- occurrence_id is ON DELETE RESTRICT, which means a night somebody paid for
-- cannot be deleted, and neither can the dance above it (dance_events cascades
-- to event_occurrences, and that cascade will hit this restrict). That is the
-- intended behaviour and it agrees with docs/decisions/0017: a night is
-- cancelled, never deleted. An instructor cancelling a sold-out night sets
-- status = 'cancelled' and the buyers get credits; an instructor deleting it
-- outright gets an error, which is the correct answer.
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete restrict,
  order_id uuid references public.orders (id) on delete restrict,
  punch_card_id uuid references public.punch_cards (id) on delete restrict,
  occurrence_id uuid not null references public.event_occurrences (id) on delete restrict,
  status public.ticket_status not null default 'valid',
  issued_at timestamptz not null default now(),
  used_at timestamptz,

  constraint tickets_exactly_one_source
    check (num_nonnulls(order_id, punch_card_id) = 1),
  constraint tickets_used_at_matches_status
    check ((status = 'used') = (used_at is not null)),

  constraint tickets_id_buyer_id_key unique (id, buyer_id),

  -- Whichever source a ticket has, it belongs to that source's buyer. MATCH
  -- SIMPLE means only the non-null one of these is checked.
  constraint tickets_order_buyer_fkey
    foreign key (order_id, buyer_id) references public.orders (id, buyer_id),
  constraint tickets_punch_card_buyer_fkey
    foreign key (punch_card_id, buyer_id) references public.punch_cards (id, buyer_id)
);

comment on table public.tickets is
  'Entitlement to ONE night. Sourced from an order or from a punch card, never both. Ownership rules that cross tables — the source order must be paid, and the night must belong to the instructor who was paid — are enforced by the check_ticket_source trigger below.';

comment on column public.tickets.status is
  'valid until used at the door or superseded. ''credited'' is what an instructor-cancelled night leaves behind, alongside a public.credits row. A no-show is a ''valid'' ticket whose night has passed — no refund and no credit, per the confirmed policy — which is why there is no no_show value to set.';

-- One punch per night per card. Without this, punching the same card twice for
-- the same occurrence burns two uses for one night — a money bug, and one that
-- an app-level guard would miss under concurrency.
create unique index tickets_one_punch_per_night
  on public.tickets (punch_card_id, occurrence_id)
  where punch_card_id is not null;

-- ---------------------------------------------------------------------------
-- credits — the instructor-cancels-a-night remedy
-- ---------------------------------------------------------------------------
--
-- The confirmed policy, in full:
--
--   * No-show: no refund, no credit. Nothing here happens.
--   * Instructor cancels a night: the buyer gets CREDIT, not cash, and it is
--     redeemable only against the SAME instructor's future dances.
--   * The credit expires 90 days after it is issued.
--   * After it has expired unused, the buyer MAY REQUEST an actual cash refund.
--     It is buyer-initiated, never automatic. The instructor absorbs the
--     original processing fee on that refund.
--
-- Partial redemption is real: a ₪40 credit against a ₪35 dance leaves ₪5, so the
-- balance lives in remaining_agorot rather than the row being all-or-nothing.
--
-- The 90 days is a DEFAULT, not a constraint. Encoding it as
-- `check (expires_at = issued_at + 90 days)` would make a goodwill extension a
-- migration, and support handing someone another fortnight is the kind of thing
-- that should not require a schema change.
create table public.credits (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users (id) on delete restrict,
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  source_order_id uuid not null references public.orders (id) on delete restrict,
  source_ticket_id uuid references public.tickets (id) on delete restrict,

  amount_agorot integer not null check (amount_agorot > 0),
  remaining_agorot integer not null check (remaining_agorot >= 0),

  status public.credit_status not null default 'active',
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  refund_requested_at timestamptz,

  constraint credits_remaining_within_amount
    check (remaining_agorot <= amount_agorot),
  constraint credits_expiry_after_issue
    check (expires_at > issued_at),
  constraint credits_redeemed_means_empty
    check (status <> 'redeemed' or remaining_agorot = 0),
  constraint credits_active_means_spendable
    check (status <> 'active' or remaining_agorot > 0),
  -- "After 90 days unused, buyer MAY request a cash refund" — so a request
  -- cannot predate the expiry, and cannot be made against a credit that has
  -- already been fully spent.
  constraint credits_refund_request_only_after_expiry
    check (refund_requested_at is null or refund_requested_at >= expires_at),
  constraint credits_refund_request_needs_balance
    check (refund_requested_at is null or remaining_agorot > 0),

  constraint credits_id_buyer_id_instructor_id_key unique (id, buyer_id, instructor_id),

  constraint credits_source_order_buyer_fkey
    foreign key (source_order_id, buyer_id) references public.orders (id, buyer_id),
  -- The instructor a credit is redeemable against is the instructor who was paid
  -- on the order it came out of. Not a convention — a foreign key.
  constraint credits_source_order_instructor_fkey
    foreign key (source_order_id, instructor_id) references public.orders (id, instructor_id),
  constraint credits_source_ticket_buyer_fkey
    foreign key (source_ticket_id, buyer_id) references public.tickets (id, buyer_id)
);

comment on table public.credits is
  'Instructor-scoped store credit, issued when an instructor cancels a night. Redeemable only against that same instructor (redeem_credit_for_ticket), for 90 days, after which a cash refund may be requested (request_credit_refund). Buyer-visible only — an instructor cannot read these rows, see the RLS section.';

comment on column public.credits.expires_at is
  'Defaults to 90 days after issue — the confirmed policy. NOT enforced as an exact interval on purpose, so extending one credit by hand does not need a migration. What IS enforced is that nothing spends a credit past this timestamp, and that lives in redeem_credit_for_ticket(), which compares against now() rather than trusting the status column.';

comment on column public.credits.source_order_id is
  'The paid order this credit came out of. Also the route to the processing fee the instructor absorbs if the buyer later cashes the credit out: orders.provider_fee_agorot on this row.';

comment on column public.credits.refund_requested_at is
  'Set by request_credit_refund(), which is the buyer asking for cash instead of credit once the 90 days have run out. Recording the REQUEST is all this migration can do — paying it needs the provider (TODO(payments-provider)), which then moves status to ''refunded''.';

-- orders.applied_credit_id, deferred to here because it points at a table that
-- did not exist yet. The FK is on all three columns: a credit can only be spent
-- on an order by the buyer it belongs to, against the instructor it is scoped
-- to. That last clause is the product rule of the entire credits feature, and
-- this is where it stops being enforceable only by careful code.
alter table public.orders
  add constraint orders_applied_credit_fkey
  foreign key (applied_credit_id, buyer_id, instructor_id)
  references public.credits (id, buyer_id, instructor_id);

-- A dance's instructor, made referenceable so sponsored_promotions can pin a
-- promotion to a dance its own instructor actually runs. Redundant next to
-- dance_events' primary key, exactly like orders_id_buyer_id_key above, and for
-- the same reason: it is the target of a composite foreign key. Adding a UNIQUE
-- constraint to an existing table in a NEW migration is not editing an applied
-- one (AGENTS.md §13) — 0001 is untouched.
alter table public.dance_events
  add constraint dance_events_id_instructor_id_key unique (id, instructor_id);

-- ---------------------------------------------------------------------------
-- sponsored_promotions
-- ---------------------------------------------------------------------------
--
-- The instructor pays the platform to surface a dance. Single-party charge: the
-- order's kind is 'sponsored_promotion', its instructor_id is the PAYER, and
-- orders_sponsored_promotion_has_no_payout keeps the payout at zero.
--
-- PROVISIONAL: `area` is a plain text field, and the five-per-area cap below is
-- keyed on it. The real definition of an "area" is an open product question —
-- it will almost certainly become geographic (a radius around the venue, or a
-- polygon), at which point both this column and enforce_sponsored_promotion_
-- area_cap() get rewritten together. Everything provisional is deliberately
-- confined to those two places so the swap is a small migration.
--
-- The area string is stored exactly as given, and a non-trimmed value is
-- REJECTED rather than silently normalised: two rows spelling the same area
-- differently would each get their own five slots, which is the cap quietly not
-- working. A loud rejection is the better failure while the definition is still
-- provisional.
create table public.sponsored_promotions (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  event_id uuid not null references public.dance_events (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,

  area text not null
    check (area = btrim(area) and length(area) between 1 and 80),

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),

  constraint sponsored_promotions_ends_after_starts check (ends_at > starts_at),

  -- You cannot promote someone else's dance, and you cannot pay for it on
  -- someone else's order.
  constraint sponsored_promotions_event_instructor_fkey
    foreign key (event_id, instructor_id) references public.dance_events (id, instructor_id),
  constraint sponsored_promotions_order_instructor_fkey
    foreign key (order_id, instructor_id) references public.orders (id, instructor_id)
);

comment on table public.sponsored_promotions is
  'An instructor paying the platform to promote one dance in one area for one window. PROVISIONAL area model — see this migration''s section header and enforce_sponsored_promotion_area_cap().';

comment on column public.sponsored_promotions.area is
  'PROVISIONAL PLACEHOLDER. Free text, exact-match, keyed on by the five-per-area cap. The real area definition is an open product question and is expected to become geographic; when it does, this column and the cap trigger are replaced together.';

comment on column public.sponsored_promotions.cancelled_at is
  'A promotion holds its slot against the cap from the moment it is created, including while its order is still pending — so a slot cannot be oversold between checkout and confirmation. The cost of that is squatting: an abandoned pending order keeps holding a slot. Releasing those is a job for the integration phase (TODO(payments-provider)); until then, setting this column is how a slot is given back.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- AGENTS.md §8: a webhook must be idempotent, deduped on the gateway transaction
-- id. This index is what makes a replay a unique violation instead of a second
-- ticket. Partial, because every order starts out with no transaction id.
create unique index orders_provider_transaction_id_key
  on public.orders (provider_transaction_id)
  where provider_transaction_id is not null;

create index orders_buyer_id_idx on public.orders (buyer_id);
create index orders_instructor_id_idx on public.orders (instructor_id);
create index orders_status_idx on public.orders (status);
create index orders_applied_credit_id_idx on public.orders (applied_credit_id);

create index tickets_buyer_id_idx on public.tickets (buyer_id);
create index tickets_occurrence_id_idx on public.tickets (occurrence_id);
create index tickets_order_id_idx on public.tickets (order_id);
create index tickets_punch_card_id_idx on public.tickets (punch_card_id);

create index punch_cards_buyer_id_idx on public.punch_cards (buyer_id);
create index punch_cards_instructor_id_idx on public.punch_cards (instructor_id);
create index punch_cards_order_id_idx on public.punch_cards (order_id);

-- The lookup the redemption screen makes: "what can I spend on this instructor".
create index credits_buyer_instructor_status_idx
  on public.credits (buyer_id, instructor_id, status);
create index credits_instructor_id_idx on public.credits (instructor_id);
create index credits_source_order_id_idx on public.credits (source_order_id);
create index credits_source_ticket_id_idx on public.credits (source_ticket_id);

create index sponsored_promotions_instructor_id_idx
  on public.sponsored_promotions (instructor_id);
create index sponsored_promotions_event_id_idx on public.sponsored_promotions (event_id);
create index sponsored_promotions_order_id_idx on public.sponsored_promotions (order_id);
-- The cap trigger's own count: same area, overlapping window.
create index sponsored_promotions_area_window_idx
  on public.sponsored_promotions (area, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Triggers — the rules a foreign key cannot state
--
-- The composite FKs above pin down "same buyer", "same instructor", "this
-- instructor's own dance". Three rules are left over, because each of them
-- depends on another row's STATE rather than on its identity, and a foreign key
-- cannot pin a column to a literal:
--
--   1. An entitlement may only exist against a PAID order of the matching kind.
--   2. A ticket's night must belong to the instructor who got paid for it.
--   3. A punch card with nothing left cannot be punched.
--   4. A promotion may only hold an area slot on a live promotion order — which
--      is the same rule as 1 with the paid requirement dropped, because a
--      promotion reserves its slot before the provider confirms anything.
--
-- All of these are security- and money-relevant, so they live in the database
-- and not in a caller (AGENTS.md §8). They are BEFORE/AFTER INSERT triggers
-- rather than checks in the RPCs, so `service_role` — which bypasses RLS and
-- will be the payment webhook's identity — is held to them too.
--
-- search_path is pinned to '' throughout, the same treatment 0001's ownership
-- helpers and 0010's stamp trigger get.
-- ---------------------------------------------------------------------------

create or replace function public.check_ticket_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid_instructor_id uuid;
  v_night_instructor_id uuid;
  v_order_status public.order_status;
  v_order_kind public.order_kind;
  v_card_status public.punch_card_status;
  v_card_remaining integer;
  v_card_expires_at timestamptz;
begin
  if new.order_id is not null then
    select o.status, o.kind, o.instructor_id
      into v_order_status, v_order_kind, v_paid_instructor_id
    from public.orders o
    where o.id = new.order_id;

    if v_order_kind <> 'ticket' then
      raise exception 'order % bought a %, not a ticket', new.order_id, v_order_kind
        using errcode = 'check_violation';
    end if;

    -- AGENTS.md §8: only the webhook marks an order paid, so this is also what
    -- stops an entitlement existing for money that never arrived.
    if v_order_status <> 'paid' then
      raise exception 'order % is %, so it cannot issue a ticket', new.order_id, v_order_status
        using errcode = 'check_violation';
    end if;
  else
    select p.status, p.remaining_uses, p.expires_at, p.instructor_id
      into v_card_status, v_card_remaining, v_card_expires_at, v_paid_instructor_id
    from public.punch_cards p
    where p.id = new.punch_card_id
    -- Serialises concurrent punches of the same card against each other, so two
    -- simultaneous requests cannot both read remaining_uses = 1.
    for update;

    if v_card_status <> 'active' then
      raise exception 'punch card % is %', new.punch_card_id, v_card_status
        using errcode = 'check_violation';
    end if;
    if v_card_remaining < 1 then
      raise exception 'punch card % has no uses left', new.punch_card_id
        using errcode = 'check_violation';
    end if;
    -- Expiry is compared against now(), never read off the status column — the
    -- same stance credits take, and for the same reason: nothing sweeps status.
    if v_card_expires_at is not null and v_card_expires_at <= now() then
      raise exception 'punch card % expired at %', new.punch_card_id, v_card_expires_at
        using errcode = 'check_violation';
    end if;
  end if;

  select e.instructor_id into v_night_instructor_id
  from public.event_occurrences o
  join public.dance_events e on e.id = o.event_id
  where o.id = new.occurrence_id;

  -- Without this, a credit or a punch card scoped to one instructor could be
  -- spent on another instructor's dance, which is the whole scoping rule gone.
  if v_night_instructor_id is distinct from v_paid_instructor_id then
    raise exception
      'night % belongs to instructor %, but this ticket was paid to instructor %',
      new.occurrence_id, v_night_instructor_id, v_paid_instructor_id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.check_ticket_source() is
  'BEFORE INSERT on public.tickets. Refuses a ticket whose source order is unpaid or of the wrong kind, whose punch card is spent or expired, or whose night belongs to a different instructor than the one who was paid. SECURITY DEFINER so the checks see the real rows regardless of the caller''s own read policies.';

create trigger tickets_check_source
  before insert on public.tickets
  for each row
  execute function public.check_ticket_source();

create or replace function public.consume_punch_card_use()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.punch_card_id is null then
    return null;
  end if;

  -- check_ticket_source already took FOR UPDATE on this row in the same
  -- transaction, so the decrement cannot lose a concurrent punch. The
  -- greatest(...) guard is belt only; punch_cards_remaining_within_total and the
  -- >= 0 check would reject an underflow anyway.
  update public.punch_cards
  set remaining_uses = remaining_uses - 1,
      status = case when remaining_uses - 1 = 0 then 'exhausted' else status end
  where id = new.punch_card_id;

  return null;
end;
$$;

comment on function public.consume_punch_card_use() is
  'AFTER INSERT on public.tickets. The only thing that decrements punch_cards.remaining_uses, so the counter cannot disagree with the tickets actually issued against the card.';

create trigger tickets_consume_punch_card
  after insert on public.tickets
  for each row
  execute function public.consume_punch_card_use();

create or replace function public.check_punch_card_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_kind public.order_kind;
begin
  select o.status, o.kind into v_status, v_kind
  from public.orders o
  where o.id = new.order_id;

  if v_kind <> 'punch_card' then
    raise exception 'order % bought a %, not a punch card', new.order_id, v_kind
      using errcode = 'check_violation';
  end if;
  if v_status <> 'paid' then
    raise exception 'order % is %, so it cannot issue a punch card', new.order_id, v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.check_punch_card_order() is
  'BEFORE INSERT on public.punch_cards. Same rule check_ticket_source applies to single tickets: an entitlement only exists against a paid order of the matching kind.';

create trigger punch_cards_check_order
  before insert on public.punch_cards
  for each row
  execute function public.check_punch_card_order();

create or replace function public.check_sponsored_promotion_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
  v_kind public.order_kind;
begin
  select o.status, o.kind into v_status, v_kind
  from public.orders o
  where o.id = new.order_id;

  if v_kind <> 'sponsored_promotion' then
    raise exception 'order % bought a %, not a promotion', new.order_id, v_kind
      using errcode = 'check_violation';
  end if;

  -- Deliberately NOT "must be paid", unlike tickets and punch cards. A
  -- promotion holds its area slot from the moment it is created, including
  -- while its order is still pending, so a slot cannot be sold twice between
  -- checkout and confirmation (see sponsored_promotions.cancelled_at). What it
  -- cannot do is hold a slot on an order that already went nowhere.
  if v_status in ('failed', 'cancelled', 'refunded') then
    raise exception 'order % is %, so it cannot hold a promotion slot', new.order_id, v_status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.check_sponsored_promotion_order() is
  'BEFORE INSERT on public.sponsored_promotions. check_punch_card_order''s sibling, minus the paid requirement: a promotion reserves its area slot while its order is still pending, so only a dead order is refused.';

create trigger sponsored_promotions_check_order
  before insert on public.sponsored_promotions
  for each row
  execute function public.check_sponsored_promotion_order();

-- ---------------------------------------------------------------------------
-- The sponsored-promotion area cap
--
-- PROVISIONAL, and marked as such in three places (this comment, the constant
-- below, and the `area` column's own comment) because it is keyed on a field
-- whose meaning is not decided yet. The rule the product asked for is "at most
-- five promoted per area"; what it has not decided is what an area IS. When that
-- lands — most likely as a radius or a polygon — this function's WHERE clause is
-- what changes, and the cap itself stays where it is.
--
-- Two decisions worth naming:
--
--   * OVERLAP, not "currently live". Five promotions running today plus a sixth
--     booked to start tomorrow is not six-at-once, so the count is restricted to
--     rows whose window actually overlaps the incoming one.
--   * PENDING ORDERS COUNT. A promotion holds its slot from creation, before the
--     provider has confirmed anything, so a slot cannot be sold twice between
--     checkout and confirmation. See sponsored_promotions.cancelled_at for the
--     cost of that choice.
--
-- The advisory lock is what makes this safe rather than merely usually right. A
-- plain count under READ COMMITTED lets two concurrent inserts both see four and
-- both succeed; the lock serialises inserts per area for the transaction's
-- lifetime. It is keyed on the area string exactly as the count is.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_sponsored_promotion_area_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- PROVISIONAL: five per area, pending the real definition of an area.
  c_max_per_area constant integer := 5;
  v_live integer;
begin
  -- A cancelled promotion holds no slot, so it needs no seat to take.
  if new.cancelled_at is not null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('sponsored_promotions.area:' || new.area)
  );

  select count(*) into v_live
  from public.sponsored_promotions p
  join public.orders o on o.id = p.order_id
  where p.area = new.area
    and p.id <> new.id
    and p.cancelled_at is null
    and o.status not in ('failed', 'cancelled', 'refunded')
    and p.starts_at < new.ends_at
    and p.ends_at > new.starts_at;

  if v_live >= c_max_per_area then
    raise exception
      'area % already has % overlapping sponsored promotions; the cap is %',
      new.area, v_live, c_max_per_area
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.enforce_sponsored_promotion_area_cap() is
  'BEFORE INSERT OR UPDATE on public.sponsored_promotions. PROVISIONAL five-per-area cap, keyed on the placeholder `area` text column and counting only promotions whose window overlaps the incoming one. Serialised per area with an advisory transaction lock, because a bare count would let concurrent inserts oversell the last slot.';

create trigger sponsored_promotions_enforce_area_cap
  before insert or update on public.sponsored_promotions
  for each row
  execute function public.enforce_sponsored_promotion_area_cap();

-- ---------------------------------------------------------------------------
-- Ownership helper
--
-- owns_occurrence is owns_event's sibling (migration 0001), one join further
-- down: the tickets table keys on a night, not on a series, and an instructor's
-- read policy has to reach through it. Same shape, same reasons — SECURITY
-- DEFINER so the policy does not depend on the caller's own read access, pinned
-- search_path so it cannot be captured.
-- ---------------------------------------------------------------------------

create or replace function public.owns_occurrence(p_occurrence_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.event_occurrences o
    join public.dance_events e on e.id = o.event_id
    join public.instructors i on i.id = e.instructor_id
    where o.id = p_occurrence_id
      and i.profile_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_occurrence(uuid) from public, anon;
grant execute on function public.owns_occurrence(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Written out per table, each preceded by a REVOKE, the same way 0001 does it —
-- so what each role can reach is reviewable here rather than inherited from
-- environment defaults.
--
-- The shape is the same for all five tables and it is deliberately narrow:
--
--   anon           nothing. No grant at all.
--   authenticated  SELECT only.
--   service_role   everything, server-side only.
--
-- No INSERT, UPDATE or DELETE for `authenticated` anywhere in this file. That is
-- not an oversight to be corrected by a later migration that adds a policy — it
-- is the security boundary. Prices, fees, payouts and credit balances must be
-- re-read from the database on the server (AGENTS.md §8), and the way to
-- guarantee that is to leave the client no way to write them at all. The two
-- SECURITY DEFINER RPCs below are the entire client-reachable write surface.
-- ---------------------------------------------------------------------------

revoke all on public.orders from anon, authenticated;
revoke all on public.tickets from anon, authenticated;
revoke all on public.punch_cards from anon, authenticated;
revoke all on public.credits from anon, authenticated;
revoke all on public.sponsored_promotions from anon, authenticated;

grant all on public.orders to service_role;
grant all on public.tickets to service_role;
grant all on public.punch_cards to service_role;
grant all on public.credits to service_role;
grant all on public.sponsored_promotions to service_role;

grant select on public.orders to authenticated;
grant select on public.tickets to authenticated;
grant select on public.punch_cards to authenticated;
grant select on public.credits to authenticated;
grant select on public.sponsored_promotions to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Two readers, and they are not symmetric.
--
--   THE BUYER sees their own orders, their own entitlements, their own credits.
--   THE INSTRUCTOR sees orders and tickets for dances they run, and their own
--   promotions — read-only, and never the buyer's credits.
--
-- The asymmetry is the point. An instructor needs to know how many people have
-- paid for Tuesday; they do not own the dancer's relationship with the platform.
-- Credits in particular are excluded: a credit is a claim a dancer holds, its
-- balance is the dancer's business, and the instructor's own liability is
-- derivable from the orders they can already see. Giving instructors a read on
-- public.credits would hand them a per-dancer balance sheet for a need nobody
-- has stated (AGENTS.md §8 — store and expose what a feature needs, nothing
-- "for later"). It is flagged as an open question rather than granted quietly.
--
-- What an instructor's order read does expose is `buyer_id`, a bare auth.users
-- uuid. That is not a join into anything readable: public.profiles is owner-only
-- (profiles_select_own, migration 0001) and nothing in a public read path joins
-- it. Turning a paid order into a NAME at the door is a separate feature that
-- has to decide, deliberately, what a buyer is willing to show an instructor.
--
-- No policy anywhere in this file names `anon`. Not a narrowed one, not a
-- time-bounded one like migration 0005 gave occurrence reads. There is also no
-- grant, so an anonymous request never gets as far as a policy.
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.tickets enable row level security;
alter table public.punch_cards enable row level security;
alter table public.credits enable row level security;
alter table public.sponsored_promotions enable row level security;

-- orders --------------------------------------------------------------------

-- Allows: a signed-in buyer to read the orders they placed.
-- Denies: reading anyone else's order, and every anonymous read.
create policy "orders_select_own_buyer"
  on public.orders for select
  to authenticated
  using ((select auth.uid()) = buyer_id);

-- Allows: an instructor to read orders where they are the counterparty — their
-- ticket and punch-card sales, and the promotions they bought from us.
-- Denies: reading another instructor's orders. Read-only: there is no write
-- grant on this table for `authenticated` at all, so no write policy is needed
-- or wanted.
create policy "orders_select_own_instructor"
  on public.orders for select
  to authenticated
  using (public.owns_instructor(instructor_id));

-- No insert/update/delete policies on this or any table below, by design. See
-- the privileges section — the grant is SELECT only, so a write is refused
-- before RLS is consulted, and adding a policy here would not change that.

-- tickets -------------------------------------------------------------------

-- Allows: a signed-in buyer to read their own tickets.
-- Denies: reading anyone else's, and every anonymous read.
create policy "tickets_select_own_buyer"
  on public.tickets for select
  to authenticated
  using ((select auth.uid()) = buyer_id);

-- Allows: an instructor to read the tickets issued for their own nights — the
-- "how many are coming on Tuesday" read (AGENTS.md §1).
-- Denies: reading tickets for a night they do not run.
create policy "tickets_select_own_instructor"
  on public.tickets for select
  to authenticated
  using (public.owns_occurrence(occurrence_id));

-- punch_cards ---------------------------------------------------------------

-- Allows: a signed-in buyer to read their own cards, including how many punches
-- are left.
-- Denies: reading anyone else's.
create policy "punch_cards_select_own_buyer"
  on public.punch_cards for select
  to authenticated
  using ((select auth.uid()) = buyer_id);

-- Allows: an instructor to read the cards sold against them — the outstanding
-- entitlement they will have to honour.
-- Denies: reading cards scoped to another instructor.
create policy "punch_cards_select_own_instructor"
  on public.punch_cards for select
  to authenticated
  using (public.owns_instructor(instructor_id));

-- credits -------------------------------------------------------------------

-- Allows: a signed-in buyer to read their own credits, which is what a "you have
-- ₪40 with דנה, until 12 בנובמבר" surface needs.
-- Denies: reading anyone else's — INCLUDING the instructor the credit is scoped
-- to. See the section header for why that is deliberate.
create policy "credits_select_own_buyer"
  on public.credits for select
  to authenticated
  using ((select auth.uid()) = buyer_id);

-- sponsored_promotions ------------------------------------------------------

-- Allows: an instructor to read their own promotions.
-- Denies: reading another instructor's, and every anonymous read.
--
-- NOTE for whoever builds the surface that actually promotes a dance on the map:
-- the map is anonymous (AGENTS.md §2.1) and this table is not readable by
-- `anon`, on purpose — an anonymous visitor has no business reading what an
-- instructor paid or when their slot runs out. That surface needs a SECURITY
-- DEFINER function returning only which event ids are currently promoted,
-- exposing none of the commercial terms, the same way find_dances_near is the
-- narrow public window onto the tables behind it.
create policy "sponsored_promotions_select_own_instructor"
  on public.sponsored_promotions for select
  to authenticated
  using (public.owns_instructor(instructor_id));

-- ---------------------------------------------------------------------------
-- The two client-reachable write paths
--
-- Both are SECURITY DEFINER, which is the opposite of what migration 0006 chose
-- for publish_dance and needs justifying rather than assuming.
--
-- publish_dance is SECURITY INVOKER because the tables it writes already carry
-- ownership policies, and running as the caller means those policies do the
-- work instead of a second copy of them drifting out of sync. These two
-- functions are in the reverse situation: `authenticated` holds NO write
-- privilege on any table here, deliberately, so an invoker function would
-- simply fail. That is not a limitation to route around — it IS the design.
-- Money tables have no client write path, and these functions are the two
-- narrow, audited exceptions.
--
-- Which puts the whole burden on them, so:
--
--   * every money figure is re-read from the database, never taken as a
--     parameter (AGENTS.md §8 — "never trust a price ... that arrived from the
--     client"). Note what these signatures do NOT accept: an amount.
--   * every row is filtered by buyer_id = auth.uid() at the point it is fetched,
--     not checked afterwards.
--   * the credit row is taken FOR UPDATE before anything is decided about it, so
--     two concurrent redemptions of one credit cannot both succeed.
--   * expiry is compared against now(), never read off credits.status — nothing
--     sweeps that column, so a stale 'active' must not be spendable.
--   * search_path is pinned to '' so nothing here can be captured by a caller's.
--   * EXECUTE is revoked from public and anon, including service_role: a
--     server-side caller holding service_role bypasses RLS anyway and should
--     write the tables directly, where its intent is visible. Same reasoning
--     migration 0006 gives.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_credit_for_ticket(
  p_credit_id uuid,
  p_occurrence_id uuid
)
returns table (
  order_id uuid,
  ticket_id uuid,
  credit_applied_agorot integer,
  credit_remaining_agorot integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_credit public.credits;
  v_instructor_id uuid;
  v_price_agorot integer;
  v_occurrence_status public.occurrence_status;
  v_starts_at timestamptz;
  v_apply integer;
  v_order_id uuid;
  v_ticket_id uuid;
  v_remaining integer;
begin
  if v_uid is null then
    raise exception 'redeeming a credit requires a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  -- Filtered by buyer_id here, in the fetch, rather than compared after the
  -- fact — a credit belonging to someone else is simply not found, and the
  -- error says nothing about whether the id exists.
  select * into v_credit
  from public.credits c
  where c.id = p_credit_id
    and c.buyer_id = v_uid
  for update;

  if not found then
    raise exception 'no such credit' using errcode = 'no_data_found';
  end if;

  if v_credit.status <> 'active' then
    raise exception 'this credit is %', v_credit.status using errcode = 'check_violation';
  end if;
  -- The real expiry check. credits.status is not consulted for this on purpose.
  if v_credit.expires_at <= now() then
    raise exception 'this credit expired on %', v_credit.expires_at
      using errcode = 'check_violation';
  end if;
  if v_credit.refund_requested_at is not null then
    raise exception 'a cash refund has already been requested for this credit'
      using errcode = 'check_violation';
  end if;
  if v_credit.remaining_agorot <= 0 then
    raise exception 'this credit has nothing left on it' using errcode = 'check_violation';
  end if;

  select e.instructor_id, e.price_agorot, o.status, o.starts_at
    into v_instructor_id, v_price_agorot, v_occurrence_status, v_starts_at
  from public.event_occurrences o
  join public.dance_events e on e.id = o.event_id
  where o.id = p_occurrence_id;

  if not found then
    raise exception 'no such night' using errcode = 'no_data_found';
  end if;

  -- The scoping rule the whole credits feature exists for. The composite FK on
  -- orders.applied_credit_id would catch a mismatch too; this is here so the
  -- caller gets a sentence instead of a constraint name.
  if v_instructor_id <> v_credit.instructor_id then
    raise exception 'this credit is only good for dances by the instructor who issued it'
      using errcode = 'check_violation';
  end if;

  if v_occurrence_status = 'cancelled' then
    raise exception 'that night is cancelled' using errcode = 'check_violation';
  end if;
  if v_starts_at <= now() then
    raise exception 'that night has already started' using errcode = 'check_violation';
  end if;

  if v_price_agorot <= 0 then
    raise exception 'that dance has no price set, so there is nothing to redeem against'
      using errcode = 'check_violation';
  end if;

  v_apply := least(v_price_agorot, v_credit.remaining_agorot);

  -- TODO(payments-provider): THIS is where the mixed credit-plus-card branch
  -- goes. When a credit covers only part of the price, the remainder has to be
  -- charged, which needs a provider that does not exist yet — so rather than
  -- decrement the credit into a 'pending_provider_confirmation' order that
  -- nothing can ever confirm (burning the credit if the payment is abandoned),
  -- this refuses and leaves the credit untouched. The integration migration
  -- replaces this branch with: create the order pending, hand the buyer off to
  -- the hosted page, and let the webhook issue the ticket and settle the credit.
  if v_apply < v_price_agorot then
    raise exception
      'this credit covers % of % agorot; paying the difference needs the payment provider, which is not integrated yet',
      v_apply, v_price_agorot
      using errcode = 'feature_not_supported';
  end if;

  -- Born 'paid' because no provider is involved: credit covers the whole price,
  -- so charged_amount_agorot is zero and orders_paid_needs_provider_reference is
  -- satisfied without a transaction id. This is the one order this schema lets
  -- anything but the webhook mark paid, and the reason is that no money moved.
  --
  -- TODO(payments-provider): platform_fee_agorot is 0 because there is no fee
  -- schedule yet — the marketplace commission is an open commercial question
  -- (AGENTS.md §14). Recording 0 says "we never charged one", not "the fee is
  -- zero"; whoever sets the schedule writes the migration that backfills it.
  -- provider_fee_agorot is genuinely 0 here: no provider was involved.
  insert into public.orders (
    buyer_id, instructor_id, kind, status,
    gross_amount_agorot, credit_applied_agorot, applied_credit_id,
    platform_fee_agorot, provider_fee_agorot
  )
  values (
    v_uid, v_instructor_id, 'ticket', 'paid',
    v_price_agorot, v_apply, p_credit_id,
    0, 0
  )
  returning id into v_order_id;

  v_remaining := v_credit.remaining_agorot - v_apply;

  update public.credits
  set remaining_agorot = v_remaining,
      status = case when v_remaining = 0 then 'redeemed'::public.credit_status else status end
  where id = p_credit_id;

  insert into public.tickets (buyer_id, order_id, occurrence_id)
  values (v_uid, v_order_id, p_occurrence_id)
  returning id into v_ticket_id;

  return query select v_order_id, v_ticket_id, v_apply, v_remaining;
end;
$$;

comment on function public.redeem_credit_for_ticket(uuid, uuid) is
  'Spends a buyer''s own instructor-scoped credit on a ticket for one of that same instructor''s future nights, in one transaction. Takes no amount — the price is re-read from dance_events (AGENTS.md §8). SECURITY DEFINER because `authenticated` deliberately holds no write privilege on any payments table; see the section header. Refuses a partial cover until the payment provider exists (TODO(payments-provider)).';

revoke all on function public.redeem_credit_for_ticket(uuid, uuid) from public, anon;
grant execute on function public.redeem_credit_for_ticket(uuid, uuid) to authenticated;

create or replace function public.request_credit_refund(p_credit_id uuid)
returns table (
  credit_id uuid,
  refund_amount_agorot integer,
  instructor_absorbed_fee_agorot integer,
  requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_credit public.credits;
  v_provider_fee integer;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'requesting a refund requires a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_credit
  from public.credits c
  where c.id = p_credit_id
    and c.buyer_id = v_uid
  for update;

  if not found then
    raise exception 'no such credit' using errcode = 'no_data_found';
  end if;

  -- Buyer-initiated and only after the 90 days have actually run out. Before
  -- that the remedy is the credit itself, which is the confirmed policy.
  if v_credit.expires_at > v_now then
    raise exception 'this credit is still usable until %; a cash refund can be asked for after that',
      v_credit.expires_at
      using errcode = 'check_violation';
  end if;

  if v_credit.status not in ('active', 'expired') then
    raise exception 'this credit is %', v_credit.status using errcode = 'check_violation';
  end if;
  if v_credit.refund_requested_at is not null then
    raise exception 'a refund has already been requested for this credit'
      using errcode = 'check_violation';
  end if;
  if v_credit.remaining_agorot <= 0 then
    raise exception 'this credit has nothing left to refund' using errcode = 'check_violation';
  end if;

  -- The processing fee the instructor absorbs, per the confirmed policy: the
  -- ORIGINAL one, off the order the credit came out of, not a fee recalculated
  -- on the way back out. It is returned rather than written anywhere, because
  -- the row that should record it is a payout adjustment, and payouts are the
  -- integration's table to design (TODO(payments-provider)).
  select o.provider_fee_agorot into v_provider_fee
  from public.orders o
  where o.id = v_credit.source_order_id;

  update public.credits
  set refund_requested_at = v_now,
      -- Past expires_at by definition of getting here, so the status column is
      -- brought in line with the timestamp that was already authoritative.
      status = 'expired'
  where id = p_credit_id;

  return query select p_credit_id, v_credit.remaining_agorot, v_provider_fee, v_now;
end;
$$;

comment on function public.request_credit_refund(uuid) is
  'Records a buyer''s request for a cash refund of their own expired, unspent credit — buyer-initiated and only after the 90 days, per the confirmed policy. Records the request only: paying it needs the payment provider (TODO(payments-provider)), which then moves credits.status to ''refunded''. Returns the original processing fee the instructor absorbs, read off the source order.';

revoke all on function public.request_credit_refund(uuid) from public, anon;
grant execute on function public.request_credit_refund(uuid) to authenticated;
