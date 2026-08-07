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
    /**
     * Says the screen is unfinished in plain words. A blank screen reads as a
     * bug to this audience (AGENTS.md §2) — an empty route still has to say
     * something.
     */
    screenNotReady: "המסך הזה עדיין בבנייה.",
  },
  home: {
    heading: "הרקדות קרובות",
    /** Shown when the proximity query comes back empty — not an error state. */
    empty: "לא נמצאו הרקדות באזור הזה בימים הקרובים.",
    listLabel: "רשימת ההרקדות הקרובות",
    /** The explicit prev/next controls alongside the scrollable ring list (AGENTS.md §2.7). */
    prevLabel: "הרקדות קודמות",
    nextLabel: "הרקדות נוספות",
  },
  map: {
    /** The map itself is a later task; this labels the area it will occupy. */
    placeholderRegionLabel: "אזור המפה",
    placeholder: "המפה תוצג כאן",
  },
  nav: {
    /** Names the <nav> landmark, so a screen reader can jump straight to it. */
    label: "ניווט ראשי",
    map: "מפה",
    schedule: "לוח",
    favorites: "מועדפים",
    profile: "שלי",
  },
  schedule: {
    heading: "לוח הרקדות",
  },
  favorites: {
    heading: "מועדפים",
  },
  profile: {
    heading: "שלי",
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
