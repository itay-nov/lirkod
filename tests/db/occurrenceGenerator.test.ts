import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jerusalemWallTimeToUtc } from "@/lib/domain/jerusalemTime";
import { jerusalemDayKey } from "@/lib/domain/occurrenceTime";
import { runAsPostgres, serviceClient, type Client } from "../rls/helpers";

/**
 * The occurrence generator (migration 0009), against a real Postgres.
 *
 * Four properties are load-bearing and each has its own block below:
 * idempotency, the horizon bound, the `overridden_at` invariant, and DST
 * correctness. Everything else here exists to support those.
 *
 * **The generator is invoked directly, never by waiting for pg_cron.** The
 * schedule is a deployment detail; the function is the thing under test, and a
 * suite that waited for 00:00 UTC would be a suite that never runs.
 *
 * `runAsPostgres` is how it is invoked, because that is the only role that may:
 * `generate_occurrences()` is revoked from every API role, which
 * tests/rls/publishRecurringDance.test.ts asserts from the other side. Fixtures
 * and verification go through `serviceClient()` as everywhere else.
 *
 * Fixtures are placed near Kiryat Shmona, ~180km from Holon, deliberately: it is
 * outside the 50km clamp `find_dances_near` applies, so nothing generated here
 * can appear in tests/db/proximity.test.ts's results whatever the calendar does.
 */

const FIXTURE_PREFIX = "generator-test-";

/** The seeded instructor. Reused so this file needs no auth users of its own. */
const SEEDED_INSTRUCTOR_ID = "a0000000-0000-0000-0000-000000000002";

const TIMEZONE = "Asia/Jerusalem";

let service: Client;
let venueId: string;

/**
 * Today's calendar date in Israel, as "YYYY-MM-DD" — the generator's own floor.
 * Through the app's own formatter rather than a second one written here, so the
 * test cannot drift from what the product means by "which day is it".
 */
function todayInIsrael(): string {
  return jerusalemDayKey(new Date().toISOString());
}

/**
 * A calendar date `days` from today in Israel.
 *
 * The arithmetic is done on a UTC midnight and only then rendered as a date, for
 * the reason `nextCalendarDay` gives in src/lib/domain/jerusalemTime.ts: UTC has
 * no DST, so adding whole days to a UTC midnight always lands on a UTC midnight.
 * Adding days to an Israel-local instant is the version that breaks twice a year.
 */
function dateFromToday(days: number): string {
  const base = Date.parse(`${todayInIsrael()}T00:00:00Z`);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

interface SeriesSpec {
  freq: "weekly" | "biweekly";
  startDate: string;
  untilDate?: string | null;
  /** "HH:MM" Israel wall clock. */
  startTime?: string;
  endTime?: string;
}

async function createSeries(spec: SeriesSpec): Promise<string> {
  const { data, error } = await service
    .from("dance_events")
    .insert({
      instructor_id: SEEDED_INSTRUCTOR_ID,
      venue_id: venueId,
      price_agorot: 0,
      recurrence_freq: spec.freq,
      recurrence_start_date: spec.startDate,
      recurrence_until_date: spec.untilDate ?? null,
      recurrence_local_start_time: spec.startTime ?? "20:00",
      recurrence_local_end_time: spec.endTime ?? "23:00",
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

/** Runs the generator for one event and returns how many rows it inserted. */
function generate(eventId: string, horizonDays?: number): number {
  const args =
    horizonDays === undefined
      ? `'${eventId}'::uuid`
      : `'${eventId}'::uuid, ${horizonDays}`;

  return Number(runAsPostgres(`select public.generate_occurrences_for_event(${args});`));
}

/** The system-wide top-up pg_cron runs — same algorithm, every recurring event. */
function generateAll(): number {
  return Number(runAsPostgres("select public.generate_occurrences();"));
}

interface OccurrenceRow {
  id: string;
  event_id: string;
  series_date: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  override_venue_id: string | null;
  cancellation_reason: string | null;
  overridden_at: string | null;
  created_at: string;
}

/** Every column, so "untouched" can be asserted as a whole row rather than a field at a time. */
async function occurrencesOf(eventId: string): Promise<OccurrenceRow[]> {
  const { data, error } = await service
    .from("event_occurrences")
    .select(
      "id, event_id, series_date, starts_at, ends_at, status, override_venue_id, cancellation_reason, overridden_at, created_at",
    )
    .eq("event_id", eventId)
    .order("starts_at");

  if (error) throw error;
  return data;
}

const wallClockFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The Asia/Jerusalem wall clock an instant falls on, as "YYYY-MM-DD HH:MM". */
function wallClockOf(instant: string): string {
  const parts = wallClockFormatter.formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  // `% 24` for the same reason jerusalemTime.ts normalises it: some ICU versions
  // render midnight as "24" under h23.
  const hour = String(Number(value("hour")) % 24).padStart(2, "0");
  return `${value("year")}-${value("month")}-${value("day")} ${hour}:${value("minute")}`;
}

async function cleanUp(): Promise<void> {
  const { data: venues } = await service
    .from("venues")
    .select("id")
    .like("name", `${FIXTURE_PREFIX}%`);

  const venueIds = (venues ?? []).map((venue) => venue.id);
  if (venueIds.length === 0) return;

  const { data: events } = await service
    .from("dance_events")
    .select("id")
    .in("venue_id", venueIds);

  const eventIds = (events ?? []).map((event) => event.id);
  if (eventIds.length > 0) {
    await service.from("event_occurrences").delete().in("event_id", eventIds);
    await service.from("dance_events").delete().in("id", eventIds);
  }
  await service.from("venues").delete().in("id", venueIds);
}

beforeAll(async () => {
  service = serviceClient();
  await cleanUp();

  const { data, error } = await service
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}hall`,
      address: "רחוב הבדיקה 1, קרית שמונה",
      location: "POINT(35.5697 33.2075)",
    })
    .select("id")
    .single();
  if (error) throw error;
  venueId = data.id;
});

afterAll(async () => {
  await cleanUp();
});

describe("idempotency — re-running the generator is a no-op", () => {
  it("inserts nothing the second time, and changes nothing about the first time's rows", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(7) });

    const first = generate(eventId, 90);
    expect(first).toBeGreaterThan(0);
    const afterFirst = await occurrencesOf(eventId);

    const second = generate(eventId, 90);

    // The count the function returns is the assertion, not a convenience: it is
    // `row_count` after INSERT ... ON CONFLICT DO NOTHING, so zero is a direct
    // statement that no row was written.
    expect(second).toBe(0);

    // And the rows are compared whole. A generator that deleted and re-inserted
    // every night would also report a full horizon each time and would pass a
    // count-only check, while handing every occurrence a new id — breaking every
    // link a dancer had saved and every Realtime subscription watching one.
    expect(await occurrencesOf(eventId)).toEqual(afterFirst);
  });

  it("is a no-op through the system-wide pass too, once the horizon is full", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(3) });
    generate(eventId);

    // generate_occurrences() walks every recurring event, so this also proves the
    // other series this file created are not re-materialised on each pass.
    expect(generateAll()).toBe(0);
  });

  it("creates one row per slot even when two passes race for the same slot", async () => {
    // Two generators overlapping is the ordinary case once a publish and the cron
    // job can both run: the unique index on (event_id, series_date) is what makes
    // the loser a no-op instead of a duplicate night.
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(2) });

    const counts = [generate(eventId, 30), generate(eventId, 30), generate(eventId, 30)];
    const rows = await occurrencesOf(eventId);

    expect(counts[1]).toBe(0);
    expect(counts[2]).toBe(0);
    expect(counts[0]).toBe(rows.length);
    expect(new Set(rows.map((row) => row.series_date)).size).toBe(rows.length);
  });
});

describe("the horizon", () => {
  it("never materialises a night past it", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(1) });

    generate(eventId, 30);
    const rows = await occurrencesOf(eventId);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(daysBetween(todayInIsrael(), row.series_date!)).toBeLessThanOrEqual(30);
    }
  });

  it("advances when the horizon moves out, and adds only the new nights", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(1) });

    const near = generate(eventId, 30);
    const far = generate(eventId, 90);

    const rows = await occurrencesOf(eventId);
    const lastDate = rows[rows.length - 1]!.series_date!;

    // This is the top-up, in one assertion: the second pass wrote only what the
    // first could not reach. It is the same thing that happens tomorrow at 00:00
    // UTC when `today` has moved a day and the far edge of the window with it.
    expect(far).toBeGreaterThan(0);
    expect(near + far).toBe(rows.length);
    expect(daysBetween(todayInIsrael(), lastDate)).toBeGreaterThan(30);
    expect(daysBetween(todayInIsrael(), lastDate)).toBeLessThanOrEqual(90);
  });

  it("does not backfill a series that has been running for months", async () => {
    // The other edge of the window, and the one that would quietly cost the most:
    // a series started 60 days ago must not arrive with 60 days of history the
    // moment it is topped up. Nothing before today is ever materialised.
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(-63) });

    generate(eventId, 30);
    const rows = await occurrencesOf(eventId);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(daysBetween(todayInIsrael(), row.series_date!)).toBeGreaterThanOrEqual(0);
    }
  });

  it("stops at the series' own end date when that comes first", async () => {
    const untilDate = dateFromToday(20);
    const eventId = await createSeries({
      freq: "weekly",
      startDate: dateFromToday(1),
      untilDate,
    });

    generate(eventId, 90);
    const rows = await occurrencesOf(eventId);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.series_date! <= untilDate).toBe(true);
    }
  });

  it("refuses an absurd horizon rather than writing what it implies", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(1) });

    expect(() => generate(eventId, 5000)).toThrow();
    expect(await occurrencesOf(eventId)).toHaveLength(0);
  });
});

describe("the overridden_at invariant (docs/decisions/0002)", () => {
  it("leaves a cancelled night byte-for-byte alone, and does not re-create its slot", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(7) });
    generate(eventId, 90);

    const first = (await occurrencesOf(eventId))[0]!;

    // A human cancelling one night — the write behind AGENTS.md §10's most
    // important moment. `overridden_at` is what marks it as theirs.
    const { error } = await service
      .from("event_occurrences")
      .update({
        status: "cancelled",
        cancellation_reason: "המרקיד חולה",
        overridden_at: new Date().toISOString(),
      })
      .eq("id", first.id);
    if (error) throw error;

    const overridden = (await occurrencesOf(eventId))[0]!;

    expect(generate(eventId, 90)).toBe(0);

    const after = await occurrencesOf(eventId);
    const sameSlot = after.filter((row) => row.series_date === first.series_date);

    // Every column, including id and created_at: "untouched" has to mean the row,
    // not just the fields the assertion happened to think of. If the generator
    // ever regenerated over this, a dancer would be told a cancelled dance is on.
    expect(sameSlot).toEqual([overridden]);
  });

  it("leaves a night whose venue was moved alone", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(8) });
    generate(eventId, 90);

    const first = (await occurrencesOf(eventId))[0]!;

    const { data: otherVenue, error: venueError } = await service
      .from("venues")
      .insert({
        name: `${FIXTURE_PREFIX}other-hall`,
        address: "רחוב הבדיקה 2, קרית שמונה",
        location: "POINT(35.5720 33.2090)",
      })
      .select("id")
      .single();
    if (venueError) throw venueError;

    const { error } = await service
      .from("event_occurrences")
      .update({
        status: "moved",
        override_venue_id: otherVenue.id,
        overridden_at: new Date().toISOString(),
      })
      .eq("id", first.id);
    if (error) throw error;

    const overridden = (await occurrencesOf(eventId))[0]!;

    expect(generate(eventId, 90)).toBe(0);
    expect((await occurrencesOf(eventId))[0]!).toEqual(overridden);
  });

  it("leaves a night whose TIME was changed alone, and creates no second night for it", async () => {
    // The case the idempotency key exists for, and the reason it is the slot date
    // rather than (event_id, starts_at). An instructor moving one night an hour
    // later vacates the rule's original timestamp; keyed on starts_at, the next
    // pass would put the 20:00 night back and the dancer would see two.
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(9) });
    generate(eventId, 90);

    const first = (await occurrencesOf(eventId))[0]!;
    const originalStartsAt = first.starts_at;
    const movedStartsAt = new Date(Date.parse(first.starts_at) + 3_600_000).toISOString();

    const { error } = await service
      .from("event_occurrences")
      .update({ starts_at: movedStartsAt, overridden_at: new Date().toISOString() })
      .eq("id", first.id);
    if (error) throw error;

    const overridden = (await occurrencesOf(eventId))[0]!;

    expect(generate(eventId, 90)).toBe(0);

    const after = await occurrencesOf(eventId);
    const sameSlot = after.filter((row) => row.series_date === first.series_date);

    expect(sameSlot).toEqual([overridden]);
    // Said separately from the row comparison because it is the failure a dancer
    // would actually see: the same evening listed twice, an hour apart.
    expect(after.filter((row) => row.starts_at === originalStartsAt)).toHaveLength(0);
  });

  it("still fills the slots around an overridden night", async () => {
    // The invariant must not become "the generator stops at the first override".
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(4) });
    generate(eventId, 30);

    const first = (await occurrencesOf(eventId))[0]!;
    const { error } = await service
      .from("event_occurrences")
      .update({
        status: "cancelled",
        cancellation_reason: "בדיקה",
        overridden_at: new Date().toISOString(),
      })
      .eq("id", first.id);
    if (error) throw error;

    expect(generate(eventId, 90)).toBeGreaterThan(0);

    const after = await occurrencesOf(eventId);
    expect(after[0]!.status).toBe("cancelled");
    expect(after.filter((row) => row.status === "scheduled").length).toBeGreaterThan(0);
  });
});

describe("DST — a series keeps its wall-clock time across a transition", () => {
  /**
   * 400 days of a weekly series, so the window always contains both of Israel's
   * transitions whatever day this suite runs on. A test pinned to a literal 2026
   * date would pass this year and become a puzzle for whoever ran it in 2028.
   */
  const HORIZON_DAYS = 400;

  it("puts every night at 20:00 Israel time, at whichever UTC instant that is", async () => {
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(7) });
    generate(eventId, HORIZON_DAYS);

    const rows = await occurrencesOf(eventId);
    expect(rows.length).toBeGreaterThan(52);

    for (const row of rows) {
      expect(wallClockOf(row.starts_at)).toBe(`${row.series_date} 20:00`);
      expect(wallClockOf(row.ends_at)).toBe(`${row.series_date} 23:00`);
    }

    // The other half of the same statement, and the one that fails if the
    // generator ever steps by 7 × 24 hours in UTC: the wall clock holding still
    // is only meaningful if the underlying instant moved.
    const utcTimes = new Set(rows.map((row) => row.starts_at.slice(11, 16)));
    expect(utcTimes.size).toBeGreaterThan(1);
  });

  it("agrees, night by night, with the conversion the app uses in TypeScript", async () => {
    // The strongest form of the DST assertion available here. `AT TIME ZONE` in
    // Postgres and `Intl` in src/lib/domain/jerusalemTime.ts are two independent
    // readers of the same IANA database, and 3.2a already converts one-off nights
    // with the second one. If they ever disagree, a dance published as a series
    // and a dance published for one night would land at different instants for
    // the same wall clock — so this pins them together rather than trusting it.
    const eventId = await createSeries({ freq: "weekly", startDate: dateFromToday(6) });
    generate(eventId, HORIZON_DAYS);

    for (const row of await occurrencesOf(eventId)) {
      const expected = jerusalemWallTimeToUtc({ date: row.series_date!, time: "20:00" });
      expect(expected).not.toHaveProperty("error");
      expect(Date.parse(row.starts_at)).toBe(
        Date.parse((expected as { utcIso: string }).utcIso),
      );
    }
  });

  it("rolls an after-midnight end time onto the next calendar day", async () => {
    // 21:00-00:30 is an ordinary הרקדה, and it has to be stored the same way the
    // one-off path stores it (src/lib/domain/newDance.ts `resolveEnd`).
    const eventId = await createSeries({
      freq: "weekly",
      startDate: dateFromToday(5),
      startTime: "21:00",
      endTime: "00:30",
    });
    generate(eventId, HORIZON_DAYS);

    for (const row of await occurrencesOf(eventId)) {
      const nextDay = new Date(
        Date.parse(`${row.series_date!}T00:00:00Z`) + 86_400_000,
      )
        .toISOString()
        .slice(0, 10);

      expect(wallClockOf(row.starts_at)).toBe(`${row.series_date} 21:00`);
      expect(wallClockOf(row.ends_at)).toBe(`${nextDay} 00:30`);
      expect(Date.parse(row.ends_at)).toBeGreaterThan(Date.parse(row.starts_at));
    }
  });
});

describe("the repeat patterns", () => {
  it("puts a weekly series on the same weekday, seven calendar days apart", async () => {
    const startDate = dateFromToday(3);
    const eventId = await createSeries({ freq: "weekly", startDate });
    generate(eventId, 60);

    const dates = (await occurrencesOf(eventId)).map((row) => row.series_date!);

    expect(dates[0]).toBe(startDate);
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1]!, dates[i]!)).toBe(7);
    }
  });

  it("keeps a biweekly series' phase, fourteen days apart from ITS start date", async () => {
    // Phase is the part that a "every other week" implementation gets wrong: the
    // steps have to be counted from the series' own start date, not from whenever
    // the generator happened to first run.
    const startDate = dateFromToday(-28);
    const eventId = await createSeries({ freq: "biweekly", startDate });
    generate(eventId, 60);

    const dates = (await occurrencesOf(eventId)).map((row) => row.series_date!);

    expect(dates.length).toBeGreaterThan(1);
    for (const date of dates) {
      expect(daysBetween(startDate, date) % 14).toBe(0);
    }
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1]!, dates[i]!)).toBe(14);
    }
  });

  it("records the pattern as RRULE text that cannot disagree with it", async () => {
    // recurrence_rule is generated from the recurrence_* columns (migration 0009),
    // so this asserts the derivation rather than a value somebody typed.
    const eventId = await createSeries({ freq: "biweekly", startDate: dateFromToday(3) });

    const { data, error } = await service
      .from("dance_events")
      .select("recurrence_rule, recurrence_start_date")
      .eq("id", eventId)
      .single();
    if (error) throw error;

    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "short",
    })
      .format(new Date(`${data.recurrence_start_date!}T12:00:00Z`))
      .slice(0, 2)
      .toUpperCase();

    expect(data.recurrence_rule).toBe(`FREQ=WEEKLY;INTERVAL=2;BYDAY=${weekday}`);
  });

  it("leaves a one-off dance alone, with no rule and no generated nights", async () => {
    const { data, error } = await service
      .from("dance_events")
      .insert({ instructor_id: SEEDED_INSTRUCTOR_ID, venue_id: venueId, price_agorot: 0 })
      .select("id, recurrence_rule")
      .single();
    if (error) throw error;

    expect(data.recurrence_rule).toBeNull();
    expect(generate(data.id, 90)).toBe(0);
    expect(await occurrencesOf(data.id)).toHaveLength(0);
  });
});
