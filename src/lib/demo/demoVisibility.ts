import { useSyncExternalStore } from "react";

/**
 * Shared, in-memory "hide all dances" flag for the DEMO_MODE toggle
 * (AGENTS.md §13 Phase 4.0) — display only, never a database write.
 *
 * A module-level singleton rather than React context: `DemoToggleButton` lives
 * in `AppHeader`, which stays mounted across navigation inside `(public)/layout.tsx`,
 * while the map and the schedule read it independently on their own screens. A
 * plain subscribable store is the smallest thing that lets all three agree
 * without a provider wrapping the whole shell.
 *
 * Only ever mutated from a browser click handler (`toggleDemoHidden`), so the
 * module-scope `hidden` variable is never written during server rendering —
 * `getServerSnapshot` always returns `false`, and nothing here reaches across
 * two different users' requests.
 */

type Listener = () => void;

let hidden = false;
const listeners = new Set<Listener>();

function getSnapshot(): boolean {
  return hidden;
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function toggleDemoHidden(): void {
  hidden = !hidden;
  for (const listener of listeners) listener();
}

/** True while the DEMO_MODE toggle has hidden every dance from the map and schedule. */
export function useDemoHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
