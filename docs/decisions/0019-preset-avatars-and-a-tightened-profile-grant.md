# 0019 — Preset avatars, a closed enum, and a tightened `profiles` UPDATE grant

## Status

Accepted. Phase 4.3.

## Context

The personal area (docs/decisions/0018, Phase 4.1) has had a name since Phase
4.1 but nothing visual — the greeting is text only. This phase adds a picture
a dancer can choose to go with it, and, separately, is the first phase that
ever issues an UPDATE against `public.profiles` from application code at all
(`saveProfileName` before this only INSERTs; renaming yourself afterwards was
never built). That second fact turned out to matter more than the avatar
feature itself — see Decision 2.

## Decision 1 — a closed set of inline SVGs, not an upload

Twelve presets: eight illustrated faces and four folk/dance symbols (a
dancer, a horah ring, a pomegranate, a pair of eighth notes), for anyone who
would rather pick a symbol than a face. Rendered from
`src/components/avatars/*.tsx`, referenced by a `public.avatar_choice`
Postgres enum (migration 0011), typed in application code as
`AvatarId = Database["public"]["Enums"]["avatar_choice"]`
(`src/lib/domain/avatar.ts`) — one source of truth, not a hand-kept list that
can drift from what the database will actually accept.

No storage bucket, no upload, this phase — explicitly out of scope per the
task that opened it. An enum is not a workaround for that absence; it is
arguably the more correct model for a curated preset set regardless, the same
way `occurrence_status` and `recurrence_freq` are enums rather than free text
(migrations 0001, 0009) — the set of valid values is closed and known ahead
of time, so let Postgres refuse an invalid one before it becomes a row.

### No skin tones

Every face uses `--color-ink` (young) or `--color-muted` (grey, reading
older) for hair, and no fill for skin at all — the head is drawn in
`--color-surface`, the same as the badge background. A small, twelve-item
preset set that included a few skin tones would say more about who was left
out than who was included; leaving the question out entirely is the safer
design for a set this size. Variety instead comes from hairstyle, colour
(age) and accessories, which is enough for "most people find one that fits"
without making a representational claim the set cannot back up.

### Default: the pomegranate, not a blank silhouette

`avatar_id` is `NOT NULL DEFAULT 'pomegranate'`. Not a face — it carries no
gender or age — and not a generic "blank person" placeholder either: it
shares its name with `--color-accent`'s own comment in `globals.css`, and a
pomegranate is a symbol this specific community already recognises. The
default is a real option someone might deliberately keep, not a stand-in for
"hasn't chosen yet."

## Decision 2 — tightening the `profiles` UPDATE grant while adding to it

0001 granted UPDATE on `profiles` table-wide:

```sql
grant select, insert, update on public.profiles to authenticated;
```

Reading every `.from("profiles")` call site in the codebase before writing
migration 0011 turned up nothing that had ever issued a profiles UPDATE —
`saveProfileName` only inserts. So that grant had been dead code at the
privilege layer since 0001: unreachable by anything in this app, but still
reachable by anyone with a session and a PostgREST client, for every column,
including `phone` and `home_location`.

This phase is what finally exercises UPDATE on this table — for
`display_name` (the rename path an existing RLS test already covered, now
actually used) and `avatar_id` (new). Migration 0011 revokes the table-wide
grant and replaces it with `grant update (display_name, avatar_id) on
public.profiles to authenticated`, the same column-scoped shape migration
0004 already established for `instructors`. `phone`, `home_location`, `id`
and `created_at` are withheld: `phone` is proved by SMS and must only change
through a new OTP verification, never a plain field edit; `home_location` has
no write path in this phase either; `id` and `created_at` were never a
client's to choose.

This is the point in the task list where AGENTS.md §13's "never change auth
as a side effect of an unrelated task" and "build the feature scoped to what
was asked" could have pulled in different directions. They did not, here: the
grant being tightened is the exact same grant the avatar column is added to,
in the same migration, because adding a genuinely-reachable UPDATE path is
the moment to close a gap next to it, not a reason to touch a table
elsewhere. `tests/rls/profileAndInstructorNameEditing.test.ts` asserts the
narrowing directly — `phone`, `home_location`, `id` and `created_at` each
fail with `42501` on their own, and combined with `display_name` /
`avatar_id` in the same statement, per Postgres privilege semantics.

## Decision 3 — the debt from docs/decisions/0018 is paid

That ADR recorded a real cost: declaring "אני מרקיד/ה" at sign-in creates the
`instructors` row from the private profile name, because there is no public
name to ask for yet at that point in the flow, and the two `display_name`
columns docs/decisions/0004 keeps apart briefly become one name doing both
jobs. The follow-up it named — "let an instructor edit their public name from
the personal area" — is what `InstructorNameForm` and
`updateInstructorNameAction` are.

**No new migration was needed for the write path itself.** Migration 0001
already granted `update (display_name, bio) on public.instructors to
authenticated` and already created `instructors_update_own`, specifically so
an instructor could edit their own public identity — confirmed by an RLS test
that has existed since that migration ("lets an instructor rename their
public identity") and was simply never exercised by any UI. Paying the debt
turned out to be a Server Action and a form, not a permission that was
missing. `docs/decisions/0018` is updated alongside this ADR to record that.

The two names remain independently editable and never touch each other:
`updateOwnProfileAction` writes only `profiles`; `updateInstructorNameAction`
writes only `instructors`. `tests/rls/profileAndInstructorNameEditing.test.ts`
asserts both directions — editing one leaves the other exactly as it was.

## Consequences

- `src/lib/db/publisher.ts`'s `Profile` type gains `avatarId: AvatarId`,
  always present (the column has a default, so there is no "profile with no
  avatar" state to model — the same reasoning `display_name` has followed
  since 0001).
- The avatar is private. It is shown in the personal-area greeting only,
  never on the public map or schedule, which read `instructors.display_name`
  and nothing else from either identity table (docs/decisions/0004). Adding
  an avatar to the PUBLIC identity — so a dancer sees a picture next to a
  dance, not only a name — is a real future feature and an open question this
  ADR does not answer.
- Uploaded avatars, if this product ever wants them, are their own decision
  with their own storage-bucket and moderation questions; this preset set
  does not block or presuppose them.
