# 0018 — Roles are derived, not stored; demo login is server-gated to fixed seed ids

## Status

Accepted. Phase 4.2.

## Context

The product has two kinds of person (AGENTS.md §1): רוקדים and מרקידים. Until now
nothing in the codebase named that distinction. It existed only implicitly, in the
shape of the data: a מרקיד is a profile that owns a row in `public.instructors`,
and every write policy is written against exactly that fact —
`owns_instructor()` and `owns_event()` (migration 0001) both reduce to
`instructors.profile_id = auth.uid()`.

Phase 4.2 needs the distinction named for two reasons, both presentational: to
decide which controls the personal area offers, and to choose which seeded
account a demo sign-in lands on. It does **not** need it for authorization —
that is already solved, in the database, and works.

Separately, showing this product to somebody requires signing in, and signing in
requires an SMS. A demo needs a way past that which cannot become a way past
authentication in production.

## Decision 1 — the role is derived from instructor-row ownership

`src/lib/domain/role.ts` exposes `UserRole = "dancer" | "instructor"` and derives
it: you are a מרקיד if and only if you own an `instructors` row. No column is
added to `profiles`; no migration is needed for the role at all.

### Why not a `profiles.role` column

A stored column is a second source of truth for something the database already
knows, and the two can disagree. The benign version of that disagreement is a
menu offering "צור אירוע" to somebody whose publish is then refused. The
dangerous version is the reason this is an ADR rather than a comment: **a column
that looks like a permission invites a policy to be written against it.** The
moment some future migration says `using (profiles.role = 'instructor')`, the
role has become the thing that authorizes writes, and the ownership check that
actually protects `dance_events` has been quietly replaced by a flag any
`profiles_update_own` caller can set on themselves. A derived role cannot be
misused that way because there is nothing to misuse — it is a `SELECT` the UI
does, and RLS never consults it.

The constraint is therefore structural, not a rule anyone has to remember:
**RLS never asks `roleFor()` anything.** Showing a control is a courtesy;
refusing a write is the security boundary, and it stays in Postgres.

### What "role" does NOT do

- It does not appear in any RLS policy, grant, or `SECURITY DEFINER` function.
- It does not gate any Server Action's *authority* — actions still re-derive the
  actor from the session cookie via `currentUser()` and let the database refuse.
- A dancer who forges client state, calls the Server Action directly, or hits
  PostgREST with the anon key is refused by RLS exactly as before. This is
  asserted live in `tests/rls/roleAndDemoLogin.test.ts`, not assumed.

## Decision 2 — the role is declared at login, not earned by publishing

Before this phase, a dancer became a מרקיד as a side effect: `/profile` showed
the publish form to *everyone*, and publishing with `needsInstructorName` called
`registerAsInstructor()` in the same step. Gating the publish form by role would
therefore have deadlocked the product — no dancer could ever have become an
instructor again, because the only path to becoming one was behind the gate.

So role establishment moves to where a person actually declares who they are:

- **At sign-in.** The phone-OTP form carries one checkbox, "אני מרקיד". Checking
  it is what calls `registerAsInstructor()`.
- **Afterwards, for anyone who did not.** A signed-in dancer sees one modest
  control, "רוצה להרקיד?", that does the same thing. Self-registration keeps
  working; nobody is stuck in the wrong role because of a checkbox they missed.

Both paths land on the *existing* unverified self-registration — the same v1
stance as before (docs/decisions/0004): `verified` stays `false`, stays outside
`authenticated`'s INSERT grant, and stays something only we can set.

**Declaring "אני מרקיד" is not a privilege grant.** It creates an unverified
`instructors` row, which `instructors_insert_own` already permits any
authenticated user to create for themselves. The checkbox therefore hands out
nothing that was not already self-service; it only saves the person a second
trip. That is why it can live on an unauthenticated-looking form without being a
hole.

Auth itself is unchanged and stays phone-OTP only (AGENTS.md §2.3). No password,
no "personal code", no email — that path was deliberately closed in Phase 3.1 and
reopening it would be the regression, not the feature.

### The cost: one name instead of two, disclosed rather than silent

docs/decisions/0004 separates the PRIVATE `profiles.display_name` from the PUBLIC
`instructors.display_name` precisely so the first is never promoted into the
second without asking — the name step's own words promise "הוא לא מוצג לרוקדים
אחרים". Declaring the role at sign-in collides with that: the instructor row has
to be created before the person has ever been asked for a public name.

Two ways out were available, and this takes the smaller one. The name step now
says something different when the box was ticked (`profileName.introInstructor`):
that the name will also be shown to dancers beside their dances, and can be
changed later. The promise is therefore never broken — it is not made. What is
lost is the *distinctness* of the two names on this path: a מרקיד who declares at
sign-in starts with one name doing both jobs.

**Follow-up, not built here:** let an instructor edit their public name from the
personal area, which would restore the split for anyone who wants it and is a
small change against the existing `instructors_update_own` policy. Until then the
publish form still asks explicitly for anyone who became an instructor without
declaring it at sign-in.

## Decision 3 — demo login is gated server-side, to a fixed table of seeded ids

A demo build can sign in by typing a small number and pressing אישור: `0` lands
on the seeded מרקיד, `1` and up on seeded רוקדים. Guest is simply not signing in.

Four independent things have to fail before this becomes an authentication
bypass, and they fail closed in this order:

1. **A server-only flag.** `DEMO_LOGIN_ENABLED` is *not* `NEXT_PUBLIC_*`, so it
   never reaches the browser bundle and cannot be flipped by a client. The
   Server Action's first statement checks it and returns a refusal before
   touching a credential, a phone number, or the network. Hiding the form is
   *not* the gate — the gate is this check, and the flag-off case is asserted to
   yield no session rather than merely no button.
2. **A fixed id table, not a lookup.** The typed number indexes a hardcoded
   array of seeded demo phones. It is never a search for "the real account whose
   number matches". A number outside the table is refused; there is no input that
   reaches an account we did not seed ourselves.
3. **Local-only OTP configuration.** The demo accounts' phones are listed under
   `[auth.sms.test_otp]` in `supabase/config.toml`, which is local/preview
   configuration. In a hosted project those numbers are not test numbers, so the
   fixed code would not verify even if the first two layers were wrong.
4. **The accounts do not exist in production.** They are created by
   `supabase/seed.sql`, which runs on `db reset` against a local stack — never
   against the hosted database.

The session itself is real. The action calls GoTrue's genuine `/verify` endpoint
server-side and writes the resulting session cookies; it does not mint a token,
does not use `service_role` to fabricate anything — that primitive is exactly
what an auth bypass is made of, and this feature does not need it — and does not
hand a credential to the browser. Everything downstream — RLS, ownership,
`owns_instructor()` — therefore applies to a demo user exactly as to anybody
else, which is the point: a demo that bypassed RLS would be demonstrating
software we do not ship.

**Only `/verify` is called, never `/otp`.** The first implementation requested a
code first, out of a wish to walk the whole real flow. That was wrong twice over:
GoTrue short-circuits a configured test number to its fixed code, so the request
sends nothing; and `/otp` is rate-limited to one call a minute per number
(`[auth.sms] max_frequency`) because it normally spends money on an SMS. The
result was a demo that failed whenever somebody signed out and back in inside a
minute — which, watching anyone actually demonstrate a role-based product, is the
first thing they do. Dropping the call fixed that, removed the need for a captcha
token (`[auth.captcha]` covers `/otp`, not `/verify`), and narrowed rather than
widened the path: `/verify` accepts the fixed code only for a number the stack
has been told is a test number, so on a hosted project it cannot produce a
session at all.

## Consequences

- No migration. The role needs no schema change, so there is no new table and no
  new policy to write (AGENTS.md §8 is satisfied vacuously here, not skipped).
- `/profile` gains a role branch: a מרקיד is offered publish and manage-nights; a
  רוקד is offered "רוצה להרקיד?" instead. Both keep מפה and לוח, which are
  guest-reachable anyway and were never role-dependent (AGENTS.md §2.2).
- `.env.example` gains `DEMO_LOGIN_ENABLED`, documented as never-in-production.
- The demo form *replaces* the OTP form in a demo build rather than sitting
  beside it, so a stakeholder sees one sign-in surface. The real OTP path is
  unchanged and is what a flag-off build ships; it stays exercised by
  `tests/e2e/signIn.spec.ts`, which runs against a non-demo build.

## Explicitly out of scope for 4.2

Recorded here so they are not silently implemented around, per AGENTS.md §13/§14.
These are future work, not decisions taken:

- Payments, tickets, and entry confirmation codes.
- The instructor analytics dashboard (still open in AGENTS.md §14 — whether it is
  its own surface or lives inside the existing instructor screens).
- Extended event fields: title, per-style time blocks, parking/gate phone, and
  the song-request form.
- Instructor *verification*. `verified` still exists, is still self-service-proof,
  and still gates nothing — unchanged from docs/decisions/0004.
