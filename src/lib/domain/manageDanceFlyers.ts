import type { OwnDanceFlyer } from "@/lib/db/dances";
import { he } from "@/lib/i18n/he";
import { formatDayHeading, formatStartTime } from "./occurrenceTime";

export interface ManageableDanceFlyer extends OwnDanceFlyer {
  /** Human-readable and unique within the list, including for duplicate series. */
  danceLabel: string;
}

/**
 * Names the target of every flyer control. Date and time distinguish recurring
 * dances at the same hall; an ordinal handles the rare exact duplicate.
 */
export function toManageableDanceFlyers(
  dances: readonly OwnDanceFlyer[],
): ManageableDanceFlyer[] {
  const baseLabels = dances.map((dance) =>
    he.manageFlyers.danceLabel(
      dance.venueName,
      formatDayHeading(dance.nextStartsAt),
      formatStartTime(dance.nextStartsAt),
    ),
  );
  const totals = new Map<string, number>();
  for (const label of baseLabels) totals.set(label, (totals.get(label) ?? 0) + 1);

  const seen = new Map<string, number>();
  return dances.map((dance, index) => {
    const baseLabel = baseLabels[index]!;
    const occurrence = (seen.get(baseLabel) ?? 0) + 1;
    seen.set(baseLabel, occurrence);
    return {
      ...dance,
      danceLabel:
        totals.get(baseLabel) === 1
          ? baseLabel
          : he.manageFlyers.numberedDanceLabel(baseLabel, occurrence),
    };
  });
}
