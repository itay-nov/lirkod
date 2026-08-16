import type { DanceFiltersLabels } from "@/components/DanceFilters";
import { he } from "@/lib/i18n/he";

/**
 * Builds `DanceFilters`' label prop from `he` — computed once, on the server,
 * by both the map's page and the schedule's, so `he.dance.level`/
 * `he.dance.formation` are read in exactly one place rather than the four
 * enum values being listed by hand twice.
 */
export function danceFiltersLabels(): DanceFiltersLabels {
  return {
    heading: he.filters.heading,
    toggle: he.filters.toggle,
    close: he.filters.close,
    levelLabel: he.filters.levelLabel,
    anyLevel: he.filters.anyLevel,
    typeLabel: he.filters.typeLabel,
    womenOnlyLabel: he.filters.womenOnlyLabel,
    levelOptions: (Object.keys(he.dance.level) as Array<keyof typeof he.dance.level>).map(
      (value) => ({ value, label: he.dance.level[value] }),
    ),
    formationOptions: (
      Object.keys(he.dance.formation) as Array<keyof typeof he.dance.formation>
    ).map((value) => ({ value, label: he.dance.formation[value] })),
  };
}
