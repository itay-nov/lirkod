"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishDanceAction,
  type PublishDanceResult,
} from "@/app/(public)/profile/actions";
import type { VenueOption } from "@/lib/db/venues";
import type { Repeat, RecurringField } from "@/lib/domain/newRecurringDance";
import { formatCalendarDateWeekday } from "@/lib/domain/occurrenceTime";
import { VenuePicker } from "./VenuePicker";
import {
  FIELD_CLASS,
  HINT_CLASS,
  LABEL_CLASS,
  PRIMARY_BUTTON_CLASS,
  RADIO_OPTION_CLASS,
} from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * Publishing a dance: where, when it starts, when it ends, and whether it comes
 * back next week.
 *
 * No title, no note and no price. Not an omission — `dance_events` has no column
 * for the first two, and nothing in the read path displays them, so collecting
 * them would mean storing text with nowhere to appear (AGENTS.md §8 rules out
 * fields "for later"). Price is out of scope for this phase; see the note in
 * `publishDance`.
 *
 * The venue comes from `VenuePicker`, which searches `venues` server-side and can
 * add a hall from Google Places when it is missing (docs/decisions/0015). Adding a
 * venue is its own write, deliberately separate from publishing.
 *
 * **There is no weekday selector, on purpose.** A recurring dance repeats on the
 * weekday of the date already chosen above, and the hint under the repeat choice
 * says which one that is. The alternative — a date field and a separate weekday
 * list — is one more control for this audience to fill in (AGENTS.md §2) and two
 * fields that can contradict each other, which someone then has to decide
 * between. Managing an existing series is 3.3b; this form only creates one.
 */

/** Native date and time inputs on purpose — see the note on the fields below. */
const DATE_TIME_FIELD_CLASS = `${FIELD_CLASS} [color-scheme:light]`;

const REPEAT_OPTIONS: ReadonlyArray<{ value: Repeat; label: string }> = [
  { value: "once", label: he.publishDance.repeatOnce },
  { value: "weekly", label: he.publishDance.repeatWeekly },
  { value: "biweekly", label: he.publishDance.repeatBiweekly },
];

export function CreateDanceForm({
  venues,
  mapsApiKey,
  instructorName,
  needsInstructorName,
}: {
  /** The first page of halls, rendered server-side so the list is not empty on arrival. */
  venues: readonly VenueOption[];
  /** Passed through to the Places field; null turns adding a venue off. */
  mapsApiKey: string | null;
  /** Prefills the public name; the profile name when there is no instructor row yet. */
  instructorName: string;
  /** True on a first publish, when the מרקיד row is created alongside the dance. */
  needsInstructorName: boolean;
}) {
  const router = useRouter();

  const [venueId, setVenueId] = useState("");
  const [publicName, setPublicName] = useState(instructorName);
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [untilDate, setUntilDate] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  /** Null until the date field holds a real calendar date. */
  const repeatWeekday = date === "" ? null : formatCalendarDateWeekday(date);

  function messageFor(result: PublishDanceResult): string {
    if (result.ok) return "";
    if (result.reason === "noNights") return he.publishDance.errors.noNights;
    if (result.reason !== "invalid") return he.publishDance.errors.failed;

    // One message, for the first field that is wrong. Naming every problem at
    // once reads as a wall of red to this audience (AGENTS.md §2); the fields are
    // few enough that fixing them one at a time is quick.
    const field: RecurringField | undefined = result.problems[0]?.field;
    return field === undefined
      ? he.publishDance.errors.failed
      : he.publishDance.errors[field];
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPublished(null);
    setBusy(true);

    try {
      const result = await publishDanceAction({
        venueId,
        date,
        startTime,
        endTime,
        repeat,
        untilDate,
        instructorName: publicName,
      });

      if (!result.ok) {
        setError(messageFor(result));
        return;
      }

      // The count is what tells an instructor the repeat actually took effect.
      // One night reads the same either way, so it keeps the single-night words.
      setPublished(
        result.occurrenceCount > 1
          ? he.publishDance.publishedSeries(result.occurrenceCount)
          : he.publishDance.published,
      );
      setVenueId("");
      setDate("");
      setStartTime("");
      setEndTime("");
      setRepeat("once");
      setUntilDate("");
      // The map and the schedule were revalidated server-side; this is what makes
      // the current screen reflect it too.
      router.refresh();
    } catch {
      setError(he.publishDance.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-8">
      <h2 className="font-display text-2xl font-black">{he.publishDance.heading}</h2>
      <p className="pt-4">{he.publishDance.intro}</p>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-6 pt-6">
        {needsInstructorName ? (
          <div>
            <label htmlFor="instructor-name" className={LABEL_CLASS}>
              {he.publishDance.instructorNameLabel}
            </label>
            <input
              id="instructor-name"
              name="instructorName"
              type="text"
              maxLength={80}
              value={publicName}
              onChange={(event) => setPublicName(event.target.value)}
              aria-describedby="instructor-name-hint"
              className={FIELD_CLASS}
            />
            <p id="instructor-name-hint" className={HINT_CLASS}>
              {he.publishDance.instructorNameHint}
            </p>
          </div>
        ) : null}

        <VenuePicker
          initialVenues={venues}
          mapsApiKey={mapsApiKey}
          venueId={venueId}
          onVenueChange={setVenueId}
        />

        {/*
          Native date and time inputs, not a custom picker. They bring the OS's
          own control — the one this audience already knows from every other app,
          already localised, already accessible, and costing no JavaScript
          (AGENTS.md §2.9). `color-scheme: light` keeps the picker chrome legible
          on the warm paper background, which globals.css commits to.
        */}
        <div>
          <label htmlFor="dance-date" className={LABEL_CLASS}>
            {he.publishDance.dateLabel}
          </label>
          <input
            id="dance-date"
            name="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={DATE_TIME_FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="dance-start" className={LABEL_CLASS}>
            {he.publishDance.startTimeLabel}
          </label>
          <input
            id="dance-start"
            name="startTime"
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            className={DATE_TIME_FIELD_CLASS}
          />
        </div>

        <div>
          <label htmlFor="dance-end" className={LABEL_CLASS}>
            {he.publishDance.endTimeLabel}
          </label>
          <input
            id="dance-end"
            name="endTime"
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            aria-describedby="dance-end-hint"
            className={DATE_TIME_FIELD_CLASS}
          />
          <p id="dance-end-hint" className={HINT_CLASS}>
            {he.publishDance.endsNextDayHint}
          </p>
        </div>

        {/*
          A visible radio list, not a select. Three options fit on the screen at
          200% text size, every one of them is a tap target of its own, and there
          is no state hidden behind opening a menu (AGENTS.md §2.5, §2.7).
        */}
        <fieldset>
          <legend className={LABEL_CLASS}>{he.publishDance.repeatLegend}</legend>

          <div className="flex flex-col gap-2">
            {REPEAT_OPTIONS.map((option) => (
              <label key={option.value} className={RADIO_OPTION_CLASS}>
                <input
                  type="radio"
                  name="repeat"
                  value={option.value}
                  checked={repeat === option.value}
                  onChange={() => setRepeat(option.value)}
                  aria-describedby={
                    option.value === "once" || repeatWeekday === null
                      ? undefined
                      : "dance-repeat-hint"
                  }
                  className="size-6 shrink-0 accent-[var(--color-secondary)]"
                />
                <span className="font-bold">{option.label}</span>
              </label>
            ))}
          </div>

          {/*
            Only once there is a date to derive it from. Naming the weekday is
            what replaces a weekday selector — see the note at the top of this
            file — so it has to be said out loud rather than left to be worked
            out from the date.
          */}
          {repeat !== "once" && repeatWeekday !== null ? (
            <p id="dance-repeat-hint" className={`${HINT_CLASS} pt-2`}>
              {he.publishDance.repeatHint(repeatWeekday)}
            </p>
          ) : null}
        </fieldset>

        {/*
          Rendered only for a repeating dance: an end date on a single night is a
          field with no meaning, and an empty one is the ordinary case for a
          weekly הרקדה, so it stays optional.
        */}
        {repeat === "once" ? null : (
          <div>
            <label htmlFor="dance-until" className={LABEL_CLASS}>
              {he.publishDance.untilDateLabel}
            </label>
            <input
              id="dance-until"
              name="untilDate"
              type="date"
              value={untilDate}
              onChange={(event) => setUntilDate(event.target.value)}
              aria-describedby="dance-until-hint"
              className={DATE_TIME_FIELD_CLASS}
            />
            <p id="dance-until-hint" className={HINT_CLASS}>
              {he.publishDance.untilDateHint}
            </p>
          </div>
        )}

        <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
          {busy ? he.publishDance.submitting : he.publishDance.submit}
        </button>
      </form>

      <p
        id="publish-dance-error"
        role="alert"
        aria-live="assertive"
        className="pt-4 font-bold text-accent"
      >
        {error}
      </p>
      <p id="publish-dance-success" aria-live="polite" className="pt-2 font-bold">
        {published ?? ""}
      </p>
    </section>
  );
}
