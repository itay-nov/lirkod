"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateInstructorNameAction,
  type UpdateInstructorNameResult,
} from "@/app/(public)/profile/actions";
import { FIELD_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * Editing the instructor's own PUBLIC name — Phase 4.3, pays the debt
 * docs/decisions/0018 recorded.
 *
 * Always visible for a מרקיד (unlike `ProfileEditForm`'s toggle), because it
 * edits something that is already on the public map and schedule right now —
 * this is closer to "here is your listing" than to a settings screen nobody
 * asked to open. Deliberately its own small form rather than a field folded
 * into `ProfileEditForm`: docs/decisions/0004 is that the private and public
 * names are two different things, and two visually separate forms are what
 * keeps that legible instead of looking like one name with an extra copy.
 */
export function InstructorNameForm({
  initialDisplayName,
}: {
  initialDisplayName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialDisplayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function messageFor(result: UpdateInstructorNameResult): string {
    if (result.ok) return "";
    if (result.reason === "nameMissing") return he.instructorName.errors.missing;
    if (result.reason === "nameTooLong") return he.instructorName.errors.tooLong;
    return he.instructorName.errors.failed;
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await updateInstructorNameAction(name);
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }
      router.refresh();
    } catch {
      setError(he.instructorName.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border-2 border-muted/50 p-4">
      <div>
        <h2 className="font-display text-xl font-bold">{he.instructorName.heading}</h2>
        <p className="pt-1 text-secondary">{he.instructorName.intro}</p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <div>
          <label htmlFor="instructor-public-name" className={LABEL_CLASS}>
            {he.instructorName.label}
          </label>
          <input
            id="instructor-public-name"
            name="instructorPublicName"
            type="text"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
          {busy ? he.instructorName.saving : he.instructorName.save}
        </button>

        <p role="alert" aria-live="assertive" className="min-h-6 font-bold text-accent">
          {error}
        </p>
      </form>
    </section>
  );
}
