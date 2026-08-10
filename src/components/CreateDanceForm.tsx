"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  publishDanceAction,
  type PublishDanceResult,
} from "@/app/(public)/profile/actions";
import type { VenueOption } from "@/lib/db/venues";
import type { NewDanceField } from "@/lib/domain/newDance";
import { VenuePicker } from "./VenuePicker";
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * Publishing one night: where, when it starts, when it ends.
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
 */

/** Native date and time inputs on purpose — see the note on the fields below. */
const DATE_TIME_FIELD_CLASS = `${FIELD_CLASS} [color-scheme:light]`;

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

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);

  function messageFor(result: PublishDanceResult): string {
    if (result.ok) return "";
    if (result.reason !== "invalid") return he.publishDance.errors.failed;

    // One message, for the first field that is wrong. Naming every problem at
    // once reads as a wall of red to this audience (AGENTS.md §2); the fields are
    // few enough that fixing them one at a time is quick.
    const field: NewDanceField | undefined = result.problems[0]?.field;
    return field === undefined
      ? he.publishDance.errors.failed
      : he.publishDance.errors[field];
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setPublished(false);
    setBusy(true);

    try {
      const result = await publishDanceAction({
        venueId,
        date,
        startTime,
        endTime,
        instructorName: publicName,
      });

      if (!result.ok) {
        setError(messageFor(result));
        return;
      }

      setPublished(true);
      setVenueId("");
      setDate("");
      setStartTime("");
      setEndTime("");
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
        {published ? he.publishDance.published : ""}
      </p>
    </section>
  );
}
