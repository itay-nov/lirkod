# 0004 — An instructor's public identity is a separate column from their private one

## Status

Accepted.

## Context

The map has to say who runs a dance, to an anonymous visitor with no account. The
obvious way to get a name onto that screen is to join `public.profiles` and read
`display_name` from there. `profiles` is owner-only, so that join would mean relaxing
its RLS policy.

## Decision

`public.instructors` carries its own `not null display_name`, readable by `anon`.
`public.profiles` stays owner-only and its policy is not relaxed.

- **`instructors`** is the **public** identity: `display_name`, `bio`, `verified`.
  Anonymous-readable by design.
- **`profiles`** is the **private** identity: `phone`, `home_location`, and the account
  holder's own `display_name`. Owner-only, and never joined into a public read path.

## Why not just expose profiles.display_name

Widening a policy on a table that also holds phone numbers and home locations means the
public read path is one careless `select *` away from leaking them. Keeping the public
name on a table that contains nothing private makes that mistake impossible rather than
merely discouraged — the same reasoning as the CHECK constraint in
[0003](./0003-moved-status-vs-override-venue.md).

The two `display_name` columns are not a duplication bug. They answer different
questions, and an instructor may legitimately want them to differ: the name the
community knows a מרקיד by is not necessarily the name on their account.

## Consequences

- A dancer who is not an instructor has no publicly visible name at all. That is correct
  for now — nothing in the read path shows one. Whenever a feature does need one
  (carpool, reviews), it needs its own decision, and the answer is not "open up
  `profiles`".
- The public name is not automatically kept in step with the private one. Nothing should
  try to sync them; they are different fields.
- `verified` sits on this public table, so it must never become self-serviceable. It is
  held down by a column-level grant, not by RLS — see the migration.
