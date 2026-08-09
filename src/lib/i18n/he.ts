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
    /** Names the map region, so a screen reader user can skip it or jump to it. */
    regionLabel: "מפת ההרקדות",
    /**
     * The map arrives after first paint (docs/decisions/0011), so this is what
     * stands in until it does. An empty box reads as a broken app to this
     * audience — the same reason `common.screenNotReady` exists.
     */
    loading: "המפה נטענת…",
    /**
     * Shown when the map cannot load at all — no key, no network, a blocked
     * script. Says where the dances still are, because they are all listed
     * below and nothing is actually lost.
     */
    unavailable: "לא הצלחנו להציג את המפה. כל ההרקדות מופיעות ברשימה שמתחת.",
    /** The explicit, visible control that asks for location. Never asked silently (AGENTS.md §9). */
    locate: "הצגת הרקדות לידי",
    locating: "מאתרים את המיקום שלך…",
    located: "המפה מציגה הרקדות ליד המיקום שלך.",
    /**
     * Covers refusal, an unavailable sensor, and a browser with no geolocation
     * at all. One message on purpose: they differ only in a cause the dancer
     * cannot act on, and all three leave the screen in the same working state.
     */
    locateFailed: "לא הצלחנו לאתר אותך. המפה ממשיכה להציג את אזור גוש דן.",
    preview: {
      /** Names the panel that opens when a pin is chosen. */
      label: "פרטי ההרקדה שנבחרה",
      close: "סגירת הפרטים",
      /** Sits where the panel will be, so the map is not a control with no visible result. */
      hint: "בחרו סימון על המפה כדי לראות פרטים ולנווט.",
      /**
       * Waze first — it is what this audience drives with in Israel (§9). Both
       * name the venue, so the link makes sense read on its own out of context.
       */
      waze: (venue: string): string => `ניווט ל${venue} עם ווייז`,
      googleMaps: (venue: string): string => `ניווט ל${venue} עם גוגל מפות`,
    },
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
    withInstructor: (instructor: string): string => `עם ${instructor}`,
    /**
     * This is `ringLabel` returning under a name that says where it is used.
     * It was removed when DanceRing and DanceRow stopped being controls — a
     * name on a role-less element is ignored by assistive tech, so it had no
     * consumer. A map pin IS a control (it is focusable and it opens the
     * preview), and a marker announces as one thing, so the whole night has to
     * arrive in one string again: when, where, with whom, and whether it is
     * still on. The status clause is what keeps a cancelled pin from sounding
     * identical to a normal one (AGENTS.md §2.6).
     */
    mapPinLabel: ({
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
