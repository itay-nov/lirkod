"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { browserClient } from "@/lib/auth/browserClient";
import {
  DANCE_FLYER_MIME_TYPES,
  MAX_DANCE_FLYER_BYTES,
  removeDanceFlyer,
  saveDanceFlyer,
  validateDanceFlyer,
} from "@/lib/storage/danceFlyers";
import { he } from "@/lib/i18n/he";
import { FIELD_CLASS, HINT_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "./formStyles";

export function DanceFlyerEditor({
  eventId,
  danceLabel,
  initialFlyerUrl,
}: {
  eventId: string;
  danceLabel: string;
  initialFlyerUrl: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [flyerUrl, setFlyerUrl] = useState(initialFlyerUrl);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (file === null) return;
    const problem = validateDanceFlyer(file);
    if (problem !== null) {
      setMessage(problem === "tooLarge" ? he.publishDance.errors.flyerTooLarge : he.publishDance.errors.flyerType);
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveDanceFlyer(browserClient(), eventId, file);
      setFlyerUrl(saved.url);
      setFile(null);
      if (input.current !== null) input.current.value = "";
      setMessage(
        saved.oldFlyerCleanupFailed
          ? he.manageFlyers.savedWithCleanupWarning
          : he.manageFlyers.saved,
      );
      router.refresh();
    } catch {
      setMessage(he.manageFlyers.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await removeDanceFlyer(browserClient(), eventId);
      setFlyerUrl(null);
      setMessage(he.manageFlyers.removed);
      router.refresh();
    } catch {
      setMessage(he.manageFlyers.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-2 border-muted/50 p-3">
      <p className="font-bold">{danceLabel}</p>
      {flyerUrl !== null && (
        <Image
          src={flyerUrl}
          alt={he.manageFlyers.currentAlt(danceLabel)}
          width={800}
          height={800}
          className="max-h-64 w-full rounded-xl object-contain"
        />
      )}
      <input
        ref={input}
        type="file"
        accept={DANCE_FLYER_MIME_TYPES.join(",")}
        aria-label={he.manageFlyers.choose(danceLabel)}
        aria-describedby={`flyer-hint-${eventId}`}
        className={`${FIELD_CLASS} min-h-12 file:me-3 file:min-h-12 file:rounded-xl file:border-0 file:bg-secondary file:px-4 file:font-bold file:text-white`}
        onChange={(event) => {
          const selected = event.target.files?.[0] ?? null;
          setFile(selected);
          if (selected === null) return;
          const problem = validateDanceFlyer(selected);
          setMessage(problem === null ? null : problem === "tooLarge" ? he.publishDance.errors.flyerTooLarge : he.publishDance.errors.flyerType);
        }}
      />
      <p id={`flyer-hint-${eventId}`} className={HINT_CLASS}>
        {he.publishDance.flyerHint(MAX_DANCE_FLYER_BYTES / 1024 / 1024)}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || file === null} onClick={() => void save()} className={PRIMARY_BUTTON_CLASS}>
          {busy ? he.manageFlyers.saving : he.manageFlyers.save}
        </button>
        {flyerUrl !== null && (
          <button type="button" disabled={busy} onClick={() => void remove()} className={SECONDARY_BUTTON_CLASS}>
            {he.manageFlyers.remove}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className="font-bold">{message ?? ""}</p>
    </div>
  );
}
