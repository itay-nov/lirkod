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
    profile: "שלי",
  },
  schedule: {
    heading: "לוח הרקדות",
    /**
     * "בחודשיים הקרובים" is not a rounded-up figure — find_dances_near looks 60
     * days ahead and no further (migration 0003), so promising more here would
     * describe a query we do not run.
     */
    empty: "לא נמצאו הרקדות באזור הזה בחודשיים הקרובים.",
    /** Names one day's list, so the days are distinguishable when tabbing between them. */
    dayListLabel: (day: string): string => `הרקדות ב${day}`,
  },
  /** Now a section inside /profile, not its own route or tab — see docs/decisions/0008. */
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
    // `ringLabel` lived here: one string carrying the whole night, because a
    // button announces as a single thing and the venue and status must not be
    // separate nodes read out of order. DanceRing and DanceRow are no longer
    // buttons and an aria-label on a role-less element is ignored, so the string
    // had no consumer. It comes back when the dance detail route makes them
    // links — see the TODO in DanceRing.tsx.
  },
} as const;
