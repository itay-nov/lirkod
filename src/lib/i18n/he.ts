/**
 * Every user-facing string (AGENTS.md §7 — no hardcoded Hebrew in components).
 *
 * Vocabulary is the community's own (§2.8): "הרקדה", not "אירוע"; "מרקיד/ה",
 * not "מארגן". Status words are full words on purpose — a cancelled dance says
 * "בוטל", never just a red ring (§2.6).
 */
export const he = {
  common: {
    appName: "לרקוד",
  },
  home: {
    heading: "הרקדות קרובות",
    /** Shown when the proximity query comes back empty — not an error state. */
    empty: "לא נמצאו הרקדות באזור הזה בימים הקרובים.",
    listLabel: "רשימת ההרקדות הקרובות",
  },
  map: {
    /** The map itself is a later task; this labels the area it will occupy. */
    placeholderRegionLabel: "אזור המפה",
    placeholder: "המפה תוצג כאן",
  },
  dance: {
    status: {
      moved: "הועבר",
      cancelled: "בוטל",
    },
    /**
     * One string with the whole context, because a screen reader announces the
     * button's label alone — the venue and status must not be separate nodes it
     * might read out of order or not at all.
     */
    ringLabel: ({
      weekday,
      time,
      venue,
      instructor,
      status,
    }: {
      weekday: string;
      time: string;
      venue: string;
      instructor: string;
      status: string | null;
    }): string =>
      `הרקדה ב${weekday} בשעה ${time}, ${venue}, עם ${instructor}${
        status === null ? "" : `. ${status}`
      }`,
  },
} as const;
