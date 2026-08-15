"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateOwnProfileAction,
  type UpdateProfileResult,
} from "@/app/(public)/profile/actions";
import type { AvatarId } from "@/lib/domain/avatar";
import { AvatarPicker } from "./AvatarPicker";
import { FIELD_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/** Matches VenuePicker.tsx's own local `TOGGLE_CLASS` — see the note on duplication in formStyles.ts. */
const TOGGLE_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary px-4 py-3 text-secondary " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

/**
 * Editing an existing name and avatar (Phase 4.3) — never shown by default.
 *
 * The greeting above this renders the current name and avatar plainly; this
 * form is behind one "עריכת הפרופיל" toggle, the same "reveal a secondary
 * form on request" shape `VenuePicker`'s "הוספת מקום חדש" already uses. A
 * dignified default screen for this audience (AGENTS.md §2) is one that does
 * not open with a form nobody asked for.
 *
 * Closing on cancel resets to the values this component was MOUNTED with,
 * not to empty fields — an abandoned edit should look like it never
 * happened, not clear what was already there.
 */
export function ProfileEditForm({
  initialDisplayName,
  initialAvatarId,
}: {
  initialDisplayName: string;
  initialAvatarId: AvatarId;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialDisplayName);
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatarId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function messageFor(result: UpdateProfileResult): string {
    if (result.ok) return "";
    if (result.reason === "nameMissing") return he.profileEdit.errors.missing;
    if (result.reason === "nameTooLong") return he.profileEdit.errors.tooLong;
    return he.profileEdit.errors.failed;
  }

  function cancel(): void {
    setName(initialDisplayName);
    setAvatarId(initialAvatarId);
    setError(null);
    setOpen(false);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await updateOwnProfileAction({ displayName: name, avatarId });
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }
      setOpen(false);
      // The greeting above reads the profile server-side; this is what makes
      // it show the new name and avatar without a full page load.
      router.refresh();
    } catch {
      setError(he.profileEdit.errors.failed);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={TOGGLE_CLASS}>
        {he.profileEdit.toggle}
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <div>
        <label htmlFor="profile-edit-name" className={LABEL_CLASS}>
          {he.profileEdit.nameLabel}
        </label>
        <input
          id="profile-edit-name"
          name="displayName"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD_CLASS}
        />
      </div>

      <AvatarPicker name="avatarId" value={avatarId} onChange={setAvatarId} />

      <div className="flex gap-3">
        <button type="submit" disabled={busy} className={PRIMARY_BUTTON_CLASS}>
          {busy ? he.profileEdit.saving : he.profileEdit.save}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          className={TOGGLE_CLASS}
        >
          {he.profileEdit.cancel}
        </button>
      </div>

      <p role="alert" aria-live="assertive" className="min-h-6 font-bold text-accent">
        {error}
      </p>
    </form>
  );
}
