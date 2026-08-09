/**
 * Turns whatever Supabase Auth failed with into one of the few things we can
 * actually tell a dancer.
 *
 * Pure, and separate from the form, for the reason AGENTS.md §3 gives: the
 * mapping is product logic (which failures deserve their own words, which
 * collapse into one) and it is the part worth testing. It is also the part that
 * would otherwise rot silently — GoTrue's `msg` strings are English prose that
 * changes between releases, so nothing here reads them. Only the stable
 * `error_code` values are matched.
 */

export type SignInErrorKind =
  /** Asked for a code again too soon. A wait fixes it. */
  | "tooSoon"
  /**
   * The SMS could not be sent: a provider outage, a misconfigured provider, an
   * unroutable number.
   *
   * Deliberately NOT folded into `tooSoon`. They look similar — no code arrived
   * either way — but the advice is opposite. "Wait a moment and try again" is
   * true of a cooldown and false of a provider failure, where waiting changes
   * nothing and trying again just fails again. Telling a 50+ dancer to wait for
   * something that will never arrive is how they conclude the app is broken and
   * stop, which is the outcome AGENTS.md §2 exists to prevent.
   */
  | "sendFailed"
  /** The captcha token was missing, stale, or refused. Ask for a fresh one. */
  | "captcha"
  /**
   * The code did not work: wrong digits, an expired code, or a code for a number
   * that never asked for one.
   *
   * These are deliberately NOT three kinds. GoTrue answers all three with the same
   * `otp_expired` / "Token has expired or is invalid" — verified against the local
   * stack — so splitting them here would mean inventing a distinction the server
   * does not make, and telling a dancer their code "expired" when they in fact
   * mistyped it. It is also the right answer on security grounds: distinguishing
   * "wrong code for a real pending request" from "no pending request at all" tells
   * an enumerator which numbers are mid-sign-in.
   */
  | "badCode"
  /** Anything we have no specific words for. */
  | "unknown";

/**
 * `tooSoon` is only for the codes that really are rate limits:
 * `over_sms_send_rate_limit` is the per-number cooldown ([auth.sms]
 * max_frequency) and `over_request_rate_limit` is the per-IP one. They differ
 * only in a cause nobody outside this repo can act on, and both are fixed by
 * waiting, so they share one message.
 *
 * `sms_send_failed` is NOT one of them and used to be listed here. It is a
 * delivery or provider-configuration failure, where waiting is not the fix and
 * saying so is a lie — see the note on `sendFailed` above.
 */
/**
 * A Map, not an object literal. `KINDS["constructor"]` on a literal resolves up
 * the prototype chain to `Object`, which is truthy, so a `?? "unknown"` fallback
 * never fires and the caller is handed a function where it expected a kind. The
 * codes here come off the wire, so that is reachable input, not a curiosity.
 */
const KINDS = new Map<string, SignInErrorKind>([
  ["over_sms_send_rate_limit", "tooSoon"],
  ["over_request_rate_limit", "tooSoon"],
  ["over_email_send_rate_limit", "tooSoon"],
  // A delivery/config failure, not a rate limit. It used to map to `tooSoon`,
  // which told the dancer to wait for an SMS that was never going to arrive.
  ["sms_send_failed", "sendFailed"],
  ["captcha_failed", "captcha"],
  ["otp_expired", "badCode"],
  ["invalid_credentials", "badCode"],
]);

export function signInErrorKind(code: string | undefined): SignInErrorKind {
  if (code === undefined) return "unknown";
  return KINDS.get(code) ?? "unknown";
}

/**
 * Digs the seconds out of GoTrue's cooldown message so the form can say how long
 * to wait instead of "try again later".
 *
 * This is the one place that does read `msg`, because the number is not exposed
 * anywhere else — there is no Retry-After on this response and no field on the
 * error object carrying it. Written to fail soft for exactly that reason: a
 * wording change upstream costs us the number and nothing else, and the caller
 * already has a message that works without it.
 */
export function retryAfterSeconds(message: string | undefined): number | null {
  if (!message) return null;
  const match = /after (\d+) seconds?/i.exec(message);
  if (!match?.[1]) return null;
  const seconds = Number.parseInt(match[1], 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
