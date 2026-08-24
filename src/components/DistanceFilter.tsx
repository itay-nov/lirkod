"use client";

import { useId } from "react";
import type { DistanceRadiusMeters } from "@/lib/domain/distanceFilter";

export interface DistanceFilterLabels {
  legend: string;
  options: ReadonlyArray<{ radiusMeters: DistanceRadiusMeters; label: string }>;
  updating: string;
  updateFailed: string;
}

/** Shared, visible distance choices for the public map and schedule. */
export function DistanceFilter({
  radiusMeters,
  onChange,
  labels,
  busy = false,
  failed = false,
}: {
  radiusMeters: DistanceRadiusMeters;
  onChange: (radiusMeters: DistanceRadiusMeters) => void;
  labels: DistanceFilterLabels;
  busy?: boolean;
  failed?: boolean;
}) {
  const name = useId();

  return (
    <fieldset aria-busy={busy} className="rounded-2xl bg-secondary/10 p-3">
      <legend className="px-1 font-display text-xl font-bold">{labels.legend}</legend>
      <div className="flex flex-wrap gap-2 pt-2">
        {labels.options.map((option) => (
          <label
            key={option.radiusMeters}
            className="flex min-h-12 items-center gap-2 rounded-full border-2 border-muted/50 px-3 py-2 font-semibold has-[:checked]:border-secondary has-[:checked]:bg-secondary has-[:checked]:text-surface has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-secondary"
          >
            <input
              type="radio"
              name={name}
              value={option.radiusMeters}
              checked={radiusMeters === option.radiusMeters}
              onChange={() => onChange(option.radiusMeters)}
              className="size-6 shrink-0 accent-[var(--color-secondary)]"
            />
            {option.label}
          </label>
        ))}
      </div>

      {busy || failed ? (
        <p
          role={failed ? "alert" : "status"}
          className={`pt-2 font-semibold ${failed ? "text-accent" : "text-secondary"}`}
        >
          {failed ? labels.updateFailed : labels.updating}
        </p>
      ) : null}
    </fieldset>
  );
}
