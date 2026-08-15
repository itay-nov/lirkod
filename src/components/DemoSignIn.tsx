"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { demoSignInAction } from "@/app/(public)/profile/demoAuthActions";
import { he } from "@/lib/i18n/he";

/**
 * The demo sign-in form: a number, a green אישור, and you are somebody.
 *
 * Rendered by /profile INSTEAD OF `PhoneSignIn`, and only in a build whose
 * server has `DEMO_LOGIN_ENABLED` set — so a demo shows one sign-in surface
 * rather than two, and production ships the real OTP form untouched
 * (docs/decisions/0018).
 *
 * This component decides nothing. It collects a number and calls a Server Action
 * that refuses unless the server flag is on and the number names a seeded
 * account; not rendering it is a courtesy to whoever is looking at the screen,
 * never the control. Read `demoAuthActions.ts` for the part that matters.
 *
 * `router.refresh()` on success rather than local state: the session now lives
 * in cookies the action wrote, so the server has to look again to render the
 * signed-in screen — the same handoff `PhoneSignIn` and `SignOutButton` use.
 */
export function DemoSignIn() {
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await demoSignInAction(number);
      if (!result.ok) {
        setError(he.demo.signIn.errors[result.reason]);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-4">
      <h2 className="font-display text-2xl font-black">{he.demo.signIn.heading}</h2>
      <p className="pt-4">{he.demo.signIn.intro}</p>

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4 pt-6">
        <div>
          <label htmlFor="demo-number" className="block pb-2 font-bold">
            {he.demo.signIn.numberLabel}
          </label>
          <input
            id="demo-number"
            name="demoNumber"
            type="text"
            // The numeric keypad on a phone, but a text input: `type="number"`
            // brings spinners and silently accepts "1e2", and the value here is
            // an index somebody reads aloud, not a quantity.
            inputMode="numeric"
            dir="ltr"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="min-h-12 w-full rounded-lg border-2 border-secondary bg-surface px-3 py-2 focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-secondary"
          />
        </div>

        {/*
          Green, as the task asked, and green that carries its own contrast: this
          is #1E7A47 on the paper surface, not a Tailwind default. The word
          "אישור" is what actually says what the button does — the colour is
          decoration, never the message (AGENTS.md §2.6).
        */}
        <button
          type="submit"
          disabled={busy}
          className="min-h-12 w-full rounded-lg bg-[#1e7a47] px-4 py-3 font-bold text-surface focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-70"
        >
          {busy ? he.demo.signIn.signingIn : he.demo.signIn.submit}
        </button>

        {/*
          Present whether or not it has text, for the reason PhoneSignIn gives:
          a live region that appears at the same moment its message does is
          announced inconsistently across screen readers.
        */}
        <p role="alert" aria-live="assertive" className="min-h-6 font-bold text-accent">
          {error}
        </p>
      </form>
    </section>
  );
}
