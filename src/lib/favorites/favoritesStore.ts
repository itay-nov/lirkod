import { useSyncExternalStore } from "react";
import {
  addFavoriteAction,
  getOwnFavoritesAction,
  removeFavoriteAction,
} from "@/app/(public)/profile/favoritesActions";
import { toggleFavoriteId } from "@/lib/domain/favoritesState";

/**
 * Shared, in-memory favorites state for the heart controls on the map,
 * schedule and profile screens (Phase 4.5).
 *
 * A module-level singleton rather than React context, the same choice
 * `demoVisibility.ts` makes and for the same reason: the heart on a map pin's
 * preview panel and the heart on a schedule row live in different parts of
 * the tree (one inside `DanceMap`'s client boundary, one passed into a
 * server-rendered `DanceRow`), and a plain subscribable store is the
 * smallest thing that lets every instance on a page agree without a provider
 * wrapping the whole shell.
 *
 * Unlike the demo toggle, this one has real data to fetch — so, distinct from
 * `demoVisibility.ts`, `getServerSnapshot` returning a fixed "signed out,
 * nothing favorited" snapshot is not just a safety fallback but the intended
 * FIRST paint: home and schedule stay anonymous and fast on the server
 * (AGENTS.md §9 — the same "map is an enhancement" stance `DanceMap` takes
 * with the Maps script), and the real fetch happens once, client-side, the
 * first time anything subscribes. A signed-in visitor sees every heart start
 * unfilled for a moment and then reflect their real favorites — never a
 * blocked or delayed first render.
 */

type Listener = () => void;

export interface FavoritesSnapshot {
  /** False until `getOwnFavoritesAction` has answered at least once. */
  loaded: boolean;
  signedIn: boolean;
  favoriteEventIds: ReadonlySet<string>;
  /** Event ids with a toggle in flight — what a button's busy state reads. */
  pendingEventIds: ReadonlySet<string>;
}

const INITIAL_SNAPSHOT: FavoritesSnapshot = {
  loaded: false,
  signedIn: false,
  favoriteEventIds: new Set(),
  pendingEventIds: new Set(),
};

let snapshot: FavoritesSnapshot = INITIAL_SNAPSHOT;
let fetchStarted = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: FavoritesSnapshot): void {
  snapshot = next;
  emit();
}

/**
 * Fired on first subscription, not on module load — nothing here runs before
 * a `FavoriteButton` actually mounts, which keeps a route that never renders
 * one (there is no such route today, but nothing should assume that) from
 * paying for a fetch it does not need.
 */
function ensureLoaded(): void {
  if (fetchStarted) return;
  fetchStarted = true;

  getOwnFavoritesAction().then(
    (result) => {
      setSnapshot({
        ...snapshot,
        loaded: true,
        signedIn: result.signedIn,
        favoriteEventIds: new Set(result.favoriteEventIds),
      });
    },
    () => {
      // A failed lookup is "signed out, nothing favorited" as far as the UI
      // is concerned — the same fallback `currentUser()` uses for every
      // failure mode. There is nothing a heart button can do differently for
      // a network error than for "nobody is signed in".
      setSnapshot({ ...snapshot, loaded: true });
    },
  );
}

function getSnapshot(): FavoritesSnapshot {
  return snapshot;
}

/**
 * Always the fixed initial snapshot — this runs during server rendering,
 * where `snapshot` is never mutated (the fetch only ever starts from a
 * browser subscription), so there is nothing else it could correctly return.
 */
function getServerSnapshot(): FavoritesSnapshot {
  return INITIAL_SNAPSHOT;
}

function subscribe(listener: Listener): () => void {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFavorites(): FavoritesSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Test-only. Being a module-level singleton is the whole point of this file
 * (see the header comment), which also means state from one test would
 * otherwise leak into the next one in the same file — this is what a
 * `beforeEach`/`afterEach` in a component test calls to start clean.
 */
export function resetFavoritesStoreForTests(): void {
  snapshot = INITIAL_SNAPSHOT;
  fetchStarted = false;
  listeners.clear();
}

/**
 * Toggles one dance, optimistically. `FavoriteButton` is what decides whether
 * this should even be called — a guest tapping the heart shows the sign-in
 * prompt instead (AGENTS.md §2.2), so this trusts `snapshot.signedIn` rather
 * than re-checking it.
 *
 * `FavoriteButton` disables itself while its id is in `pendingEventIds`, so
 * one id is never mid-flight twice at once — which is what makes "toggle the
 * set again" a safe, correct revert on failure: flipping the same id's
 * membership twice always lands back where it started.
 *
 * Resolves `true` on success and `false` on a reverted failure, so the
 * caller can say so (AGENTS.md §6 — never swallow) rather than leaving a
 * dancer to wonder why the heart quietly flipped back.
 */
export async function toggleFavorite(eventId: string): Promise<boolean> {
  if (!snapshot.signedIn) return false;

  const { ids, wasFavorited } = toggleFavoriteId(snapshot.favoriteEventIds, eventId);
  setSnapshot({
    ...snapshot,
    favoriteEventIds: ids,
    pendingEventIds: new Set(snapshot.pendingEventIds).add(eventId),
  });

  function revert(): void {
    setSnapshot({
      ...snapshot,
      favoriteEventIds: toggleFavoriteId(snapshot.favoriteEventIds, eventId).ids,
    });
  }

  let succeeded = true;
  try {
    const result = wasFavorited
      ? await removeFavoriteAction(eventId)
      : await addFavoriteAction(eventId);
    if (!result.ok) {
      succeeded = false;
      revert();
    }
  } catch {
    succeeded = false;
    revert();
  } finally {
    const stillPending = new Set(snapshot.pendingEventIds);
    stillPending.delete(eventId);
    setSnapshot({ ...snapshot, pendingEventIds: stillPending });
  }

  return succeeded;
}
