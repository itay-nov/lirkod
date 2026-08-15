/**
 * What "tap the heart" means to a set of favorited event ids — pure and
 * DOM-free (AGENTS.md §3), so `favoritesStore.ts` (the client-only store that
 * actually calls the server) has one thing left to do: call this, then call
 * the server action, then revert if it fails.
 */

export interface ToggledFavorites {
  ids: ReadonlySet<string>;
  /** What the id's membership was BEFORE this toggle — the write to send. */
  wasFavorited: boolean;
}

/** Flips one id's membership in a set, without mutating the set given. */
export function toggleFavoriteId(ids: ReadonlySet<string>, eventId: string): ToggledFavorites {
  const wasFavorited = ids.has(eventId);
  const next = new Set(ids);

  if (wasFavorited) {
    next.delete(eventId);
  } else {
    next.add(eventId);
  }

  return { ids: next, wasFavorited };
}
