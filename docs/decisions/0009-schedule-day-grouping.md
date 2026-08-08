# 0009 — The schedule groups by Asia/Jerusalem day keys, without a date library

## Status

Accepted.

## Context

`/schedule` shows the same dances the map shows, arranged under one header per
calendar day. AGENTS.md §7 requires those days to be Israeli calendar days, and
in the same breath says never to do date math with raw `Date` arithmetic across
DST — "use the date library configured in the repo".

There is no date library configured in the repo. `src/lib/domain/occurrenceTime.ts`
says why: its formatters do no arithmetic, so none was needed, and it warns that
the first feature needing "is this tonight?" or "add 3 hours" would need one.
Day grouping looked like exactly that feature.

## Decision

Group on a `"YYYY-MM-DD"` key derived from `Intl.DateTimeFormat` with
`timeZone: "Asia/Jerusalem"` (`jerusalemDayKey`), and add no dependency.

The key is built from `formatToParts` under a fixed `en-US` locale rather than
from a formatted `en-CA` string. It is an internal grouping identity that is
never displayed, so it must not change shape with a locale or a CLDR update — a
key that silently reordered its fields would split one day into two headers.

## Why this is not the arithmetic §7 forbids

The tempting implementation *is* arithmetic: derive local midnight, add 24 hours,
compare each occurrence against the boundaries. That breaks twice a year, because
an Israeli calendar day is 23 or 25 hours long across a DST shift, and it is
precisely what §7 is warning about.

Asking `Intl` which calendar date an instant falls on in a named timezone
computes no interval at all. The timezone database already knows the answer,
including on DST days. There is nothing left for a library to get right, so
adding one would be a dependency bought for no capability — which §13 forbids
independently.

## Where this stops being enough

This covers bucketing and display only. The moment the schedule needs relative
day labels ("היום" / "מחר"), a date range filter, or any duration, that is real
arithmetic and this decision does not stretch to cover it. Add a library then,
in its own task, rather than growing helpers here — the tests in
`tests/unit/scheduleDays.test.ts` pin the DST behaviour that any replacement has
to keep.

## Consequences

- `DanceDay.dances` is typed as a non-empty tuple, so the day header can read
  `dances[0].startsAt` under `noUncheckedIndexedAccess` without a `!` or an
  unreachable empty-day branch.
- Grouping uses a `Map` keyed by day rather than a scan that starts a new group
  when the key changes. The scan is shorter but silently depends on
  `find_dances_near` keeping its `order by starts_at`; if that ever changed, the
  result would not be an error but one day rendered as two headers.
- `/schedule` is now `force-dynamic`, like the map and for the same §10 reason.
  `/profile` is the only public route that still prerenders.
