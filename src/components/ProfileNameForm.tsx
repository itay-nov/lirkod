"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveProfileName, type ProfileNameResult } from "@/app/(public)/profile/actions";
import { FIELD_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * The one question between signing in and using the app: what should we call you.
 *
 * It exists because `profiles.display_name` is NOT NULL with no default
 * (migration 0001) — there is no such thing as a profile row without a name, so
 * this cannot be deferred behind a "skip" the way an optional field could.
 *
 * Rendered INLINE on /profile, in place of the profile content, for the same
 * reason the sign-in form is (docs/decisions/0013): the route stays reachable and
 * explains itself rather than redirecting someone who arrived not knowing an
 * account was involved.
 */
export function ProfileNameForm({
  /**
   * True when "אני מרקיד/ה" was ticked on the way in and there was no profile yet
   * to attach the role to, so this step is about to create BOTH rows.
   *
   * It changes the words, and that is the whole point. The default intro promises
   * this name is private and never shown to other dancers — which would be a lie
   * the moment it also became the public מרקיד name. docs/decisions/0004 exists
   * because the private and public names are different things and promoting one
   * into the other silently publishes a name nobody agreed to show.
   */
  becomingInstructor = false,
}: {
  becomingInstructor?: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function messageFor(result: ProfileNameResult): string {
    if (result.ok) return "";
    if (result.reason === "nameMissing") return he.profileName.errors.missing;
    if (result.reason === "nameTooLong") return he.profileName.errors.tooLong;
    // signedOut and failed both mean "not now, try again" to the person reading
    // it — the session case resolves itself on the refresh below.
    return he.profileName.errors.failed;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await saveProfileName(name);
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }
      // The server decides what /profile shows next; this component never
      // renders the signed-in screen itself.
      router.refresh();
    } catch {
      // Not swallowed (AGENTS.md §6): a thrown action — a dropped connection, a
      // constraint we did not anticipate — has exactly one useful answer for a
      // dancer, and an error boundary here would replace a working form with a
      // crash screen.
      setError(he.profileName.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pt-4">
      <h2 className="font-display text-2xl font-black">{he.profileName.heading}</h2>
      <p className="pt-4">
        {becomingInstructor ? he.profileName.introInstructor : he.profileName.intro}
      </p>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 pt-6">
        <div>
          <label htmlFor="profile-name" className={LABEL_CLASS}>
            {he.profileName.label}
          </label>
          <input
            id="profile-name"
            name="displayName"
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
          {busy ? he.profileName.saving : he.profileName.save}
        </button>
      </form>

      {/*
        Rendered whether or not it has text: a live region that appears at the
        same moment its content does is announced inconsistently across screen
        readers. Same pattern as the sign-in form.
      */}
      <p
        id="profile-name-error"
        role="alert"
        aria-live="assertive"
        className="pt-4 font-bold text-accent"
      >
        {error}
      </p>
    </section>
  );
}
