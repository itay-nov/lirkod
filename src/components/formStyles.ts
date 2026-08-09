/**
 * The field and button conventions the /profile forms share.
 *
 * Every one of these encodes an AGENTS.md §2 rule rather than a taste: `min-h-12`
 * is the 48px tap-target floor stated explicitly instead of left to whatever the
 * padding happens to add up to, and the 4px `focus-visible` outline is the same
 * ring the tab bar and the ring scroller already draw, so a keyboard user meets
 * one convention across the app.
 *
 * `PhoneSignIn.tsx` still declares its own identical copies. That is deliberate
 * and not an oversight: it is auth code, and AGENTS.md §13 rules out changing
 * auth as a side effect of an unrelated task. Converging them is a one-line
 * change for whoever next has a reason to touch that file.
 */

export const FIELD_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary bg-surface px-3 py-2 " +
  "focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-secondary";

export const PRIMARY_BUTTON_CLASS =
  "min-h-12 w-full rounded-lg bg-secondary px-4 py-3 font-bold text-surface " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

export const LABEL_CLASS = "block pb-2 font-bold";

/** Secondary text: --color-secondary is 8.9:1 on surface, so it clears §2.6. */
export const HINT_CLASS = "pt-1 text-secondary";
