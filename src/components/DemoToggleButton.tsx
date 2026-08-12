"use client";

import { toggleDemoHidden, useDemoHidden } from "@/lib/demo/demoVisibility";
import { he } from "@/lib/i18n/he";

/**
 * The DEMO_MODE "hide all dances" switch, rendered by `AppHeader` only when
 * `NEXT_PUBLIC_DEMO_MODE` is set (AGENTS.md §13 Phase 4.0). View only: it
 * flips a shared in-memory flag (`src/lib/demo/demoVisibility.ts`) that the map
 * and the schedule read to filter what they already fetched — it never deletes
 * or writes anything, and a page reload always comes back showing everything.
 *
 * `ms-auto` pushes it to the header's inline-end, away from the wordmark,
 * without hardcoding a physical side (AGENTS.md §7).
 */
export function DemoToggleButton() {
  const hidden = useDemoHidden();

  return (
    <button
      type="button"
      onClick={toggleDemoHidden}
      aria-pressed={hidden}
      className="ms-auto flex min-h-12 min-w-12 items-center justify-center rounded-full border-2 border-secondary px-4 py-2 font-semibold text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
    >
      {hidden ? he.demo.show : he.demo.hide}
    </button>
  );
}
