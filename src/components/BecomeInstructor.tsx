"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { declareInstructorAction } from "@/app/(public)/profile/actions";
import { he } from "@/lib/i18n/he";

/**
 * What a signed-in רוקד sees where a מרקיד sees the publish and manage surfaces.
 *
 * The secondary half of role declaration (docs/decisions/0018). The primary half
 * is the "אני מרקיד/ה" checkbox on the sign-in form; this exists so that missing
 * it is not permanent — before this phase the role was a side effect of
 * publishing, so gating publish by role without this control would have meant
 * nobody could ever become a מרקיד again.
 *
 * One visible, tappable control and no hidden path (AGENTS.md §2.7). It grants
 * nothing the database did not already allow: `declareInstructorAction` creates
 * an UNVERIFIED instructors row, which `instructors_insert_own` permits any
 * authenticated person to create for themselves.
 */
export function BecomeInstructor() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function declare(): Promise<void> {
    setFailed(false);
    setBusy(true);
    try {
      const result = await declareInstructorAction();
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // The role is derived from a row that now exists, so the server has to
      // re-read to render the instructor surfaces. Nothing is decided here.
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border-2 border-secondary p-4">
      <h2 className="font-display text-2xl font-black">
        {he.profile.becomeInstructor.heading}
      </h2>
      <p className="pt-2">{he.profile.becomeInstructor.intro}</p>

      <button
        type="button"
        onClick={() => void declare()}
        disabled={busy}
        className="mt-4 min-h-12 w-full rounded-lg bg-secondary px-4 py-3 font-bold text-surface focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-70"
      >
        {busy ? he.profile.becomeInstructor.working : he.profile.becomeInstructor.cta}
      </button>

      <p role="alert" aria-live="assertive" className="min-h-6 pt-2 font-bold text-accent">
        {failed ? he.profile.becomeInstructor.failed : ""}
      </p>
    </section>
  );
}
