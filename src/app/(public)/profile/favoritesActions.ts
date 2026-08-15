"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/auth/serverClient";
import { currentUser } from "@/lib/auth/session";
import { addFavorite, findOwnFavoriteEventIds, removeFavorite } from "@/lib/db/favorites";

/**
 * The heart toggle's three Server Actions, separate from actions.ts because
 * they are reachable from three routes — home, schedule and this one — not
 * only from this screen (AGENTS.md §13: keep the diff scoped, and a file
 * named for one route is the wrong home for code three routes import).
 *
 * Every one of them re-derives WHO IS ACTING from the session cookie via
 * `currentUser()`, never from an argument — the same stance actions.ts takes
 * and for the same reason: a Server Action is a public HTTP endpoint with a
 * generated name, not a private function (AGENTS.md §8).
 */

export interface OwnFavorites {
  signedIn: boolean;
  favoriteEventIds: string[];
}

/**
 * What the client-side heart controls need to know: is anyone signed in, and
 * which dances have they already saved.
 *
 * Called from the browser, after first paint (`favoritesStore.ts`) — never
 * from the map or schedule page's own server render, which stay anonymous
 * and fast on purpose (AGENTS.md §9, and the note on `currentUser` about not
 * being called on the public map path). This is the same "enhancement, not a
 * precondition for the screen" stance `DanceMap` already takes with the Maps
 * script itself.
 */
export async function getOwnFavoritesAction(): Promise<OwnFavorites> {
  const user = await currentUser();
  if (user === null) return { signedIn: false, favoriteEventIds: [] };

  const client = await serverClient();
  const favoriteEventIds = await findOwnFavoriteEventIds(client, user.id);
  return { signedIn: true, favoriteEventIds };
}

export type FavoriteWriteResult = { ok: true } | { ok: false; reason: "signedOut" | "failed" };

/**
 * Saves one dance for the caller. Idempotent — see `addFavorite`'s own note —
 * so a double tap or two racing tabs never surfaces as an error.
 */
export async function addFavoriteAction(eventId: string): Promise<FavoriteWriteResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const client = await serverClient();
  await addFavorite(client, { userId: user.id, eventId });

  // The only server-rendered surface that reads favorites — home and
  // schedule learn about them client-side (favoritesStore.ts) and never
  // block their own render on a session lookup.
  revalidatePath("/profile");
  return { ok: true };
}

/** Un-saves one dance for the caller. Also idempotent — see `removeFavorite`. */
export async function removeFavoriteAction(eventId: string): Promise<FavoriteWriteResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const client = await serverClient();
  await removeFavorite(client, { userId: user.id, eventId });

  revalidatePath("/profile");
  return { ok: true };
}
