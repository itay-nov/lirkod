"use client";

import { useId, useState } from "react";
import type { DanceFormation, DanceLevel } from "@/lib/db/dances";
import { isEmptyDanceFilter, type DanceAttributeFilter } from "@/lib/domain/danceFilter";

/**
 * The level/type/women-only filter (Phase 4.6b), shared by the map
 * (NearbyDances.tsx) and the schedule (ScheduleList.tsx) so the two screens
 * offer one filter vocabulary instead of two.
 *
 * Every label arrives as a prop rather than through `he` — the same
 * discipline `DanceMap`/`NearbyDances` already follow (docs/decisions/0007):
 * a bundler cannot tree-shake individual properties off the `he` object
 * literal, so importing it here would ship the whole dictionary to every
 * screen this filter appears on, for four Hebrew words this component needs.
 *
 * Collapsed behind one toggle button by default — see `he.filters.toggle`'s
 * own comment for why: ten always-visible controls ahead of the map/ring
 * list or the schedule's rows is a real keyboard-reach cost on the busiest
 * screens in the app, for a refinement most visits never use.
 *
 * Open, it is a plain radio list for level (never a dropdown — AGENTS.md
 * §2.7, the same reasoning `CreateDanceForm`'s repeat choice already
 * follows) plus one radio for "הכול", real checkboxes for the multi-valued
 * type, and one checkbox for women-only. Every control clears the 48px
 * floor via `min-h-12` (§5).
 */

export interface DanceFiltersLabels {
  heading: string;
  toggle: string;
  close: string;
  levelLabel: string;
  /** The default, unfiltered level option — distinct from a dance's own "כל הרמות" attribute. */
  anyLevel: string;
  typeLabel: string;
  womenOnlyLabel: string;
  levelOptions: ReadonlyArray<{ value: DanceLevel; label: string }>;
  formationOptions: ReadonlyArray<{ value: DanceFormation; label: string }>;
}

const RADIO_CLASS =
  "flex min-h-12 items-center gap-2 rounded-full border-2 border-muted/50 px-3 py-1 " +
  "has-[:checked]:border-secondary has-[:checked]:bg-secondary/10 " +
  "has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-secondary";

const TOGGLE_CLASS =
  "min-h-12 w-fit rounded-full border-2 border-secondary px-4 py-2 font-semibold text-secondary " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary";

export function DanceFilters({
  filter,
  onChange,
  labels,
}: {
  filter: DanceAttributeFilter;
  onChange: (next: DanceAttributeFilter) => void;
  labels: DanceFiltersLabels;
}) {
  // Starts open when a filter arrives already active (e.g. after a client
  // navigation that kept the previous screen's state) — never closed while
  // hiding the fact that something is filtered.
  const [open, setOpen] = useState(!isEmptyDanceFilter(filter));
  const panelId = useId();

  function toggleFormation(formation: DanceFormation, checked: boolean): void {
    onChange({
      ...filter,
      formations: checked
        ? [...filter.formations, formation]
        : filter.formations.filter((existing) => existing !== formation),
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-controls={panelId}
        className={TOGGLE_CLASS}
      >
        {labels.toggle}
      </button>
    );
  }

  return (
    <section
      id={panelId}
      aria-label={labels.heading}
      className="flex flex-col gap-3 rounded-2xl bg-highlight/15 p-4"
    >
      <fieldset>
        <legend className="pb-2 font-bold">{labels.levelLabel}</legend>
        <div className="flex flex-wrap gap-2">
          <label className={RADIO_CLASS}>
            <input
              type="radio"
              name="dance-filter-level"
              checked={filter.level === null}
              onChange={() => onChange({ ...filter, level: null })}
              className="size-5 shrink-0 accent-[var(--color-secondary)]"
            />
            {labels.anyLevel}
          </label>
          {labels.levelOptions.map((option) => (
            <label key={option.value} className={RADIO_CLASS}>
              <input
                type="radio"
                name="dance-filter-level"
                checked={filter.level === option.value}
                onChange={() => onChange({ ...filter, level: option.value })}
                className="size-5 shrink-0 accent-[var(--color-secondary)]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="pb-2 font-bold">{labels.typeLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {labels.formationOptions.map((option) => (
            <label key={option.value} className={RADIO_CLASS}>
              <input
                type="checkbox"
                checked={filter.formations.includes(option.value)}
                onChange={(event) => toggleFormation(option.value, event.target.checked)}
                className="size-5 shrink-0 accent-[var(--color-secondary)]"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className={`${RADIO_CLASS} w-fit`}>
        <input
          type="checkbox"
          checked={filter.womenOnly}
          onChange={(event) => onChange({ ...filter, womenOnly: event.target.checked })}
          className="size-5 shrink-0 accent-[var(--color-secondary)]"
        />
        {labels.womenOnlyLabel}
      </label>

      <button
        type="button"
        onClick={() => setOpen(false)}
        className={`${TOGGLE_CLASS} self-start`}
      >
        {labels.close}
      </button>
    </section>
  );
}
