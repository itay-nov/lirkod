import type { Client } from "@/lib/db/client";

export const DANCE_FLYER_BUCKET = "dance-flyers";
export const MAX_DANCE_FLYER_BYTES = 5 * 1024 * 1024;
export const DANCE_FLYER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type DanceFlyerProblem = "notImage" | "tooLarge";

export function validateDanceFlyer(file: Pick<File, "size" | "type">): DanceFlyerProblem | null {
  if (!(DANCE_FLYER_MIME_TYPES as readonly string[]).includes(file.type)) return "notImage";
  if (file.size > MAX_DANCE_FLYER_BYTES) return "tooLarge";
  return null;
}

export function danceFlyerPath(eventId: string, version = crypto.randomUUID()): string {
  return `${eventId}/flyer-${version}`;
}

export function publicDanceFlyerUrl(client: Client, path: string | null): string | null {
  if (path === null) return null;
  return client.storage.from(DANCE_FLYER_BUCKET).getPublicUrl(path).data.publicUrl;
}

export interface SavedDanceFlyer {
  url: string;
  /** The new flyer is attached; only the now-unreferenced prior object remains. */
  oldFlyerCleanupFailed: boolean;
}

/** Uploads and attaches one flyer using the caller's session and Storage RLS. */
export async function saveDanceFlyer(
  client: Client,
  eventId: string,
  file: File,
): Promise<SavedDanceFlyer> {
  const problem = validateDanceFlyer(file);
  if (problem !== null) throw new Error(problem);

  const previous = await client
    .from("dance_events")
    .select("flyer_path")
    .eq("id", eventId)
    .maybeSingle();
  if (previous.error || previous.data === null) {
    if (previous.error) throw previous.error;
    throw new Error("danceNotFound");
  }

  const path = danceFlyerPath(eventId);

  const uploaded = await client.storage.from(DANCE_FLYER_BUCKET).upload(path, file, {
    cacheControl: "0",
    contentType: file.type,
    upsert: false,
  });
  if (uploaded.error) throw uploaded.error;

  const attached = await client
    .from("dance_events")
    .update({ flyer_path: path })
    .eq("id", eventId)
    .select("id");

  if (attached.error || attached.data.length !== 1) {
    await client.storage.from(DANCE_FLYER_BUCKET).remove([path]);
    if (attached.error) throw attached.error;
    throw new Error("danceNotOwned");
  }

  let oldFlyerCleanupFailed = false;
  if (previous.data.flyer_path !== null) {
    const removedPrevious = await client.storage
      .from(DANCE_FLYER_BUCKET)
      .remove([previous.data.flyer_path]);
    oldFlyerCleanupFailed = removedPrevious.error !== null;
  }

  return { url: publicDanceFlyerUrl(client, path)!, oldFlyerCleanupFailed };
}

/** Detaches first, then removes the object; restores the pointer if removal fails. */
export async function removeDanceFlyer(client: Client, eventId: string): Promise<void> {
  const current = await client
    .from("dance_events")
    .select("flyer_path")
    .eq("id", eventId)
    .maybeSingle();
  if (current.error || current.data === null) {
    if (current.error) throw current.error;
    throw new Error("danceNotFound");
  }
  if (current.data.flyer_path === null) return;
  const path = current.data.flyer_path;
  const detached = await client
    .from("dance_events")
    .update({ flyer_path: null })
    .eq("id", eventId)
    .select("id");
  if (detached.error) throw detached.error;
  if (detached.data.length !== 1) throw new Error("danceNotOwned");

  const removed = await client.storage.from(DANCE_FLYER_BUCKET).remove([path]);
  if (removed.error) {
    const restored = await client
      .from("dance_events")
      .update({ flyer_path: path })
      .eq("id", eventId)
      .select("id");
    if (restored.error) throw restored.error;
    if (restored.data.length !== 1) throw new Error("danceFlyerRestoreFailed");
    throw removed.error;
  }
}
