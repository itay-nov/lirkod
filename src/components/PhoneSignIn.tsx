"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { declareInstructorAction } from "@/app/(public)/profile/actions";
import { browserClient } from "@/lib/auth/browserClient";
import { normalizeIsraeliPhone } from "@/lib/domain/phone";
import { retryAfterSeconds, signInErrorKind } from "@/lib/domain/signInError";
import { he } from "@/lib/i18n/he";
import { SecurityCheck, type SecurityCheckHandle } from "./SecurityCheck";

/**
 * Phone-OTP sign-in, rendered INLINE on /profile — never as a redirect gate.
 *
 * The whole screen is identity, so it is the one place an account is asked for;
 * but /profile itself stays publicly reachable, because a dancer who followed a
 * link here without knowing they need an account should land on an explanation,
 * not on a redirect that makes the destination invisible (AGENTS.md §2.2).
 *
 * Two steps rather than one form with two fields. A field for a code that has not
 * been sent yet is a question this audience cannot answer, and answering it wrong
 * is how people conclude an app is broken (§2).
 *
 * Everything that is not React lives elsewhere: the number is normalised by
 * `src/lib/domain/phone.ts`, the failure is classified by
 * `src/lib/domain/signInError.ts`, and the words are in `he.ts` (§3, §6, §7).
 * What is left here is the form.
 */

type Step = "phone" | "code";

/** GoTrue is configured for six digits (`[auth.sms] otp_length`). */
const CODE_LENGTH = 6;

const FIELD_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary bg-surface px-3 py-2 " +
  "focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-secondary";

const PRIMARY_BUTTON_CLASS =
  "min-h-12 w-full rounded-lg bg-secondary px-4 py-3 font-bold text-surface " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

const SECONDARY_BUTTON_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary px-4 py-3 text-secondary " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

export function PhoneSignIn({ siteKey }: { siteKey: string | null }) {
  const router = useRouter();
  const check = useRef<SecurityCheckHandle>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  /** E.164, set only once the number has been accepted. What GoTrue is given. */
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeUnavailable, setChallengeUnavailable] = useState(false);
  /**
   * "אני מרקיד/ה", answered on the way in (docs/decisions/0018).
   *
   * Held here across BOTH steps on purpose: the box is on the phone step, but it
   * cannot be acted on until the code has been verified, and re-asking after the
   * SMS would be asking the same question twice.
   */
  const [wantsInstructor, setWantsInstructor] = useState(false);

  /*
   * Focus follows the step. The button that was pressed no longer exists once the
   * form swaps, so without this a keyboard user is dropped back to the top of the
   * document with no indication that anything happened.
   *
   * In an effect rather than straight after `setStep`: the input is not mounted
   * until React commits, so `ref.current` is still null at that point — and a
   * `requestAnimationFrame` is not a fix either, because it can fire before the
   * commit. Caught by tests/e2e/signIn.spec.ts, which is why it is asserted there.
   */
  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  async function sendCode(normalized: string): Promise<void> {
    const token = await check.current?.token();
    if (!token) {
      setError(he.signIn.errors.captcha);
      return;
    }

    const { error: sendError } = await browserClient().auth.signInWithOtp({
      phone: normalized,
      options: { captchaToken: token },
    });

    // Spent either way: Turnstile tokens are single-use, so the next attempt —
    // including a resend — needs a new one.
    check.current?.reset();

    if (sendError) {
      const kind = signInErrorKind(sendError.code);
      const seconds = kind === "tooSoon" ? retryAfterSeconds(sendError.message) : null;
      setError(
        seconds === null ? he.signIn.errors[kind] : he.signIn.errors.tooSoonIn(seconds),
      );
      return;
    }

    setPhone(normalized);
    setStep("code");
  }

  async function onSubmitPhone(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const normalized = normalizeIsraeliPhone(phoneInput);
    if (normalized === null) {
      setError(he.signIn.errors.invalidPhone);
      return;
    }

    setBusy(true);
    try {
      await sendCode(normalized);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitCode(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const digits = code.replace(/\D/g, "");
    if (digits.length !== CODE_LENGTH) {
      setError(he.signIn.errors.invalidCode);
      return;
    }

    setBusy(true);
    try {
      const { error: verifyError } = await browserClient().auth.verifyOtp({
        phone,
        token: digits,
        type: "sms",
      });

      if (verifyError) {
        setError(he.signIn.errors[signInErrorKind(verifyError.code)]);
        return;
      }

      // Only now, and only if they asked. The action re-derives who is acting
      // from the session cookie this verify just established — it takes no
      // arguments, so "make me a מרקיד" is the whole of what is being said here.
      // Its result is deliberately not surfaced: the role is a preference, and
      // failing to record one must not read as a failure to sign in, which HAS
      // just succeeded. `/profile` will show "רוצה להרקיד?" if it did not take.
      if (wantsInstructor) await declareInstructorAction();

      // The session now lives in cookies, so the server has to look again — this
      // is what swaps /profile over to the signed-in content without a full page
      // load and without this component ever deciding what that content is.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function onResend(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await sendCode(phone);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-4">
      <h2 className="font-display text-2xl font-black">{he.signIn.heading}</h2>
      <p className="pt-4">{he.signIn.intro}</p>

      {siteKey === null ? (
        <p role="alert" className="pt-4 font-bold">
          {he.signIn.errors.notConfigured}
        </p>
      ) : (
        <>
          {step === "phone" ? (
            <form onSubmit={(e) => void onSubmitPhone(e)} className="flex flex-col gap-4 pt-6">
              <div>
                <label htmlFor="signin-phone" className="block pb-2 font-bold">
                  {he.signIn.phoneLabel}
                </label>
                <input
                  id="signin-phone"
                  name="phone"
                  type="tel"
                  // The numeric keypad, and the browser's own saved number — both
                  // remove typing from a step that is pure typing.
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder={he.signIn.phonePlaceholder}
                  className={FIELD_CLASS}
                />
              </div>

              {/*
                Role declared on the way in (docs/decisions/0018), above the
                security check so it reads as part of "who are you" rather than
                as an afterthought under the button.

                A real <input type="checkbox"> wrapped in its own <label>, not a
                styled div with a click handler: it has to be reachable by Tab,
                toggleable with Space, and announced as a checkbox.

                size-12 — the box ITSELF is 48x48, not merely the label around
                it. AGENTS.md §5 is about the control, and a 24px box inside a
                48px row passes a casual reading while still handing a
                70-year-old a 24px target to hit; tests/e2e/signIn.spec.ts
                measures every `form input` and catches exactly that. A large,
                unmissable checkbox is the right answer for this audience
                anyway (§2).
              */}
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  name="wantsInstructor"
                  checked={wantsInstructor}
                  onChange={(e) => setWantsInstructor(e.target.checked)}
                  className="size-12 shrink-0 accent-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                />
                <span className="font-bold">{he.signIn.instructorLabel}</span>
              </label>
              <p className="-mt-2 text-secondary">{he.signIn.instructorHint}</p>

              <SecurityCheck
                ref={check}
                siteKey={siteKey}
                label={he.signIn.securityCheckLabel}
                onUnavailable={() => setChallengeUnavailable(true)}
              />

              <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                {busy ? he.signIn.sending : he.signIn.sendCode}
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void onSubmitCode(e)} className="flex flex-col gap-4 pt-6">
              <p aria-live="polite">{he.signIn.codeSentTo(phone)}</p>

              <div>
                <label htmlFor="signin-code" className="block pb-2 font-bold">
                  {he.signIn.codeLabel}
                </label>
                <input
                  id="signin-code"
                  ref={codeInputRef}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  // Lets the phone offer the code straight from the SMS, which
                  // for this audience is the difference between one tap and
                  // switching apps to copy six digits by hand.
                  autoComplete="one-time-code"
                  maxLength={CODE_LENGTH}
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>

              <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
                {busy ? he.signIn.verifying : he.signIn.submitCode}
              </button>

              {/*
                Both are real buttons, always visible. Getting back to the phone
                step must not depend on the browser's back button, and asking for
                a new code must not depend on reloading the page (AGENTS.md §2.7).
              */}
              <button
                type="button"
                onClick={() => void onResend()}
                disabled={busy}
                className={SECONDARY_BUTTON_CLASS}
              >
                {he.signIn.resend}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setError(null);
                }}
                disabled={busy}
                className={SECONDARY_BUTTON_CLASS}
              >
                {he.signIn.changePhone}
              </button>
            </form>
          )}

          {/*
            One live region for both failures, rendered whether or not there is
            anything in it — a region that appears at the same moment its text
            does is announced inconsistently across screen readers. role="alert"
            rather than colour or an icon, because a message nobody hears is the
            same class of bug as state carried by colour alone (§2.6).
          */}
          <p
            id="signin-error"
            role="alert"
            aria-live="assertive"
            className="pt-4 font-bold text-accent"
          >
            {challengeUnavailable ? he.signIn.errors.securityCheckUnavailable : error}
          </p>
        </>
      )}
    </section>
  );
}
