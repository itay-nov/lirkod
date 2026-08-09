/**
 * Israeli mobile numbers in, E.164 out (AGENTS.md §7 — accept the formats people
 * actually type, normalise on the way in, store `+9725…`).
 *
 * Pure and DOM-free, so the sign-in form, a future server action and a Capacitor
 * shell can all share one definition of "what counts as a phone number" instead
 * of each growing its own (AGENTS.md §3).
 */

/**
 * Mobile only, and that is a product constraint rather than a simplification: the
 * number has to be able to receive an SMS, and a landline typed into the sign-in
 * form is a dead end we can name immediately instead of one the dancer discovers
 * by waiting for a code that never arrives.
 *
 * Israeli mobile is 05X followed by seven digits. The set of live X values is
 * narrower than 0-9 today, but which prefixes the Ministry of Communications has
 * allocated changes without telling us, and refusing a real dancer's number is far
 * worse here than accepting a well-formed unreachable one — the undelivered SMS
 * answers that question anyway.
 */
const LOCAL_MOBILE = /^05\d{8}$/;

const ISRAEL_COUNTRY_CODE = "972";

/**
 * Everything a person plausibly types or pastes between the digits: spaces,
 * hyphens, the dots some keypads produce, and the brackets in "(050) 123-4567".
 *
 * The \u200e-\u202e range is the RTL tax. A Hebrew keyboard and a `dir="rtl"`
 * input make it easy to end up with directional marks embedded in a pasted
 * number. They render as nothing, so a dancer whose correct-looking number is
 * refused has no way to see why — strip them rather than fail on them.
 */
const SEPARATORS = /[\s().\u200e\u200f\u202a-\u202e-]/g;

/**
 * Strips whatever spells "international prefix" and hands back the rest, or null
 * if this was never an international number to begin with.
 *
 * "00" is how a landline keypad and an older phonebook write it, "+" is how a
 * modern one does, and a bare "972…" is what you get pasting a number back out of
 * something that stores E.164 without the plus — GoTrue's own `user.phone`, for
 * one. A local Israeli number starts "05", so none of the three can be mistaken
 * for one.
 */
function withoutInternationalPrefix(cleaned: string): string | null {
  if (cleaned.startsWith("+")) return cleaned.slice(1);
  if (cleaned.startsWith("00")) return cleaned.slice(2);
  if (cleaned.startsWith(ISRAEL_COUNTRY_CODE)) return cleaned;
  return null;
}

/**
 * Returns the number as E.164, or null if it is not a valid Israeli mobile.
 *
 * Null means "tell the dancer this is not a mobile number we can text". It never
 * means "something went wrong" — the caller has one message for every rejection
 * here, because every rejection has the same fix.
 */
export function normalizeIsraeliPhone(input: string): string | null {
  const cleaned = input.replace(SEPARATORS, "");
  if (cleaned.length === 0) return null;

  const international = withoutInternationalPrefix(cleaned);

  let local: string | null;
  if (international === null) {
    local = cleaned;
  } else if (international.startsWith(ISRAEL_COUNTRY_CODE)) {
    // "+972 50 …" and "+972 050 …" are both in circulation. The trunk "0" is
    // dropped in E.164, so restore exactly one before validating and the two
    // spellings converge on the same answer.
    const national = international.slice(ISRAEL_COUNTRY_CODE.length);
    local = `0${national.startsWith("0") ? national.slice(1) : national}`;
  } else {
    // A country code that is not Israel's. Nothing to normalise — this is not a
    // number this product can text.
    local = null;
  }

  if (local === null || !LOCAL_MOBILE.test(local)) return null;

  return `+${ISRAEL_COUNTRY_CODE}${local.slice(1)}`;
}

/**
 * E.164 back into the shape an Israeli reads: "+972501234567" → "050-1234567".
 *
 * Storage and display are separate concerns (AGENTS.md §7 says the same about
 * money and about times, and for the same reason). `+972…` is correct in the
 * database and unreadable to a 50+ dancer checking they signed in with the right
 * number.
 *
 * Also accepts the plus-less form, because that is what GoTrue hands back in
 * `user.phone`. Anything it cannot parse is returned untouched: a number we fail
 * to recognise is still better shown than hidden.
 */
export function formatIsraeliPhone(stored: string): string {
  const normalized = normalizeIsraeliPhone(stored);
  if (normalized === null) return stored;

  const local = `0${normalized.slice(1 + ISRAEL_COUNTRY_CODE.length)}`;
  return `${local.slice(0, 3)}-${local.slice(3)}`;
}
