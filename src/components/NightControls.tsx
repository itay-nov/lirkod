"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  cancelNightAction,
  moveNightVenueAction,
  rescheduleNightAction,
  type ManageNightResult,
} from "@/app/(public)/profile/actions";
import type { ManageableNight } from "@/lib/domain/manageNight";
import type { VenueOption } from "@/lib/db/venues";
import { VenuePicker } from "./VenuePicker";
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * The controls for ONE night: move it to a different hour or venue, or take it off.
 *
 * Three shapes rather than one, all of them inline on the page:
 *
 *   closed  → a single button naming the night
 *   open    → the venue/time fields, and a button that starts a cancellation
 *   confirm → the reason box and an explicit yes/no
 *
 * **No dialog, native or otherwise.** `window.confirm` would be the two-line
 * version of the confirm step and is exactly wrong for this audience: it renders
 * at the browser's own size, ignores the page's text scaling, and cannot be read
 * at 200% (AGENTS.md §2.4). An inline step is also where the reason box can
 * live, which a confirm box has nowhere to put.
 *
 * **Cancelling is two taps, moving the time is one.** Not symmetry for its own
 * sake — a mis-typed hour is visible and fixable on the same screen, whereas a
 * cancellation is what a dancer reads and acts on, and nothing on this screen
 * puts it back (see the note in docs/decisions/0017 about restoring).
 *
 * Every string arrives pre-formatted on `night` (see `manageNight.ts`), so this
 * component ships no `Intl`, no dictionary of dates and no status table.
 */

const SECONDARY_BUTTON_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary px-4 py-3 font-bold text-secondary " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

/** The one destructive control on the screen, so it does not borrow the primary style. */
const DANGER_BUTTON_CLASS =
  "min-h-12 w-full rounded-lg bg-accent px-4 py-3 font-bold text-surface " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

const TIME_FIELD_CLASS = `${FIELD_CLASS} [color-scheme:light]`;

type Mode = "closed" | "open" | "confirmCancel";

export function NightControls({
  night,
  venues,
  recentVenues,
  mapsApiKey,
}: {
  night: ManageableNight;
  venues: readonly VenueOption[];
  recentVenues: readonly VenueOption[];
  mapsApiKey: string | null;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("closed");
  const [startTime, setStartTime] = useState(night.startTimeField);
  const [endTime, setEndTime] = useState(night.endTimeField);
  const [venueId, setVenueId] = useState(night.venueId);
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const panelId = `night-panel-${night.id}`;
  const statusId = `night-status-${night.id}`;
  const currentVenue = {
    id: night.venueId,
    name: night.venueName,
    address: night.venueAddress,
  };
  const pickerVenues = venues.some((venue) => venue.id === night.venueId)
    ? venues
    : [currentVenue, ...venues];

  function messageFor(result: ManageNightResult): string {
    if (result.ok) return "";
    if (result.reason === "invalid") return he.manageNights.errors[result.field];
    if (result.reason === "notYours") return he.manageNights.errors.notYours;
    return he.manageNights.errors.failed;
  }

  async function run(
    call: () => Promise<ManageNightResult>,
    success: string,
  ): Promise<void> {
    setError(null);
    setDone(null);
    setBusy(true);

    try {
      const result = await call();
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }

      setDone(success);
      setMode("closed");
      // The action revalidated /profile, / and /schedule server-side; this is
      // what makes the row the instructor is looking at reflect it too.
      router.refresh();
    } catch {
      setError(he.manageNights.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-2">
      {/*
        The name does NOT change when the panel opens. It names the night, and
        `aria-expanded` carries the open/closed state — which is the whole
        contract of a disclosure. An earlier version swapped the text to
        "סגירה", which left a screen reader user with a control that no longer
        said which of twelve evenings it belonged to. The visible way out is the
        explicit button at the end of the panel instead, next to what it closes.
      */}
      <button
        type="button"
        onClick={() => setMode(mode === "closed" ? "open" : "closed")}
        aria-expanded={mode !== "closed"}
        aria-controls={panelId}
        className={SECONDARY_BUTTON_CLASS}
      >
        {he.manageNights.manage(night.whenText)}
      </button>

      {/*
        Rendered only when open rather than hidden with CSS: a display:none
        subtree is still in the tab order in some browsers, and a form this
        audience cannot see but can tab into is worse than one that is not there.
      */}
      {mode !== "closed" && (
        <div id={panelId} className="flex flex-col gap-4 pt-4">
          {mode === "open" && (
            <>
              <div className="flex flex-col gap-4">
                <VenuePicker
                  initialVenues={pickerVenues}
                  recentVenues={recentVenues}
                  mapsApiKey={mapsApiKey}
                  venueId={venueId}
                  idPrefix={`night-${night.id}`}
                  legend={he.manageNights.changeVenueHeading}
                  onVenueChange={setVenueId}
                />

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => moveNightVenueAction(night.id, venueId),
                      he.manageNights.venueSaved,
                    )
                  }
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {busy ? he.manageNights.savingVenue : he.manageNights.saveVenue}
                </button>
              </div>

              <fieldset>
                <legend className={LABEL_CLASS}>{he.manageNights.changeTimeHeading}</legend>

                <div className="flex flex-col gap-4 pt-1">
                  <div>
                    <label htmlFor={`start-${night.id}`} className={LABEL_CLASS}>
                      {he.manageNights.startTimeLabel}
                    </label>
                    <input
                      id={`start-${night.id}`}
                      type="time"
                      value={startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      className={TIME_FIELD_CLASS}
                    />
                  </div>

                  <div>
                    <label htmlFor={`end-${night.id}`} className={LABEL_CLASS}>
                      {he.manageNights.endTimeLabel}
                    </label>
                    <input
                      id={`end-${night.id}`}
                      type="time"
                      value={endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      className={TIME_FIELD_CLASS}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => rescheduleNightAction(night.id, startTime, endTime),
                        he.manageNights.timeSaved,
                      )
                    }
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {busy ? he.manageNights.savingTime : he.manageNights.saveTime}
                  </button>
                </div>
              </fieldset>

              {/*
                Absent, not disabled, on a night that is already off. A disabled
                control is something this audience taps repeatedly waiting for it
                to work (AGENTS.md §2.7).
              */}
              {!night.cancelled && (
                <button
                  type="button"
                  onClick={() => setMode("confirmCancel")}
                  className={DANGER_BUTTON_CLASS}
                >
                  {he.manageNights.cancelStart}
                </button>
              )}

              {/* The visible way out, at the end of what it closes. */}
              <button
                type="button"
                onClick={() => setMode("closed")}
                className={SECONDARY_BUTTON_CLASS}
              >
                {he.manageNights.close}
              </button>
            </>
          )}

          {mode === "confirmCancel" && (
            <div className="flex flex-col gap-4">
              <p className="font-bold">{he.manageNights.cancelHeading}</p>
              <p>{he.manageNights.cancelIntro}</p>

              <div>
                <label htmlFor={`reason-${night.id}`} className={LABEL_CLASS}>
                  {he.manageNights.reasonLabel}
                </label>
                <input
                  id={`reason-${night.id}`}
                  type="text"
                  maxLength={200}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-describedby={`reason-hint-${night.id}`}
                  className={FIELD_CLASS}
                />
                <p id={`reason-hint-${night.id}`} className={HINT_CLASS}>
                  {he.manageNights.reasonHint}
                </p>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => cancelNightAction(night.id, reason),
                    he.manageNights.cancelled,
                  )
                }
                className={DANGER_BUTTON_CLASS}
              >
                {busy ? he.manageNights.cancelling : he.manageNights.cancelConfirm}
              </button>

              {/* The way out, spelled as an outcome rather than as "ביטול" —
                  which in a cancellation flow would mean two opposite things. */}
              <button
                type="button"
                onClick={() => setMode("open")}
                className={SECONDARY_BUTTON_CLASS}
              >
                {he.manageNights.cancelBack}
              </button>
            </div>
          )}
        </div>
      )}

      {/*
        One live region per night, holding both outcomes. `assertive` for the
        error because it is a message the instructor has to act on; the success
        text sits in the same element so a screen reader is not told two things
        at once about one action.
      */}
      <p id={statusId} role="status" aria-live="assertive" className="pt-2 font-bold">
        {error ?? done ?? ""}
      </p>
    </div>
  );
}
