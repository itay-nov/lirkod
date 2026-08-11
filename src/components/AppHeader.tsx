import { DemoToggleButton } from "@/components/DemoToggleButton";
import { he } from "@/lib/i18n/he";

/**
 * The slim top bar: an accent dot beside the wordmark, and — outside
 * production — the DEMO_MODE "hide all dances" toggle.
 *
 * A Server Component; the only interactive piece is `DemoToggleButton`, opted
 * into the client bundle by that component's own `"use client"`, not this
 * one's. It is not a link back to the map, because the map already has its own
 * tab in TabBar and two different controls for one destination is a thing to
 * explain rather than a thing to use (AGENTS.md §2).
 *
 * `NEXT_PUBLIC_DEMO_MODE` is read the same way `page.tsx` reads
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. This runs server-side, so unset (the
 * production default) `DemoToggleButton` is simply never rendered — a real
 * dancer gets no button, no `aria-pressed` control, nothing to tab onto or
 * click (AGENTS.md §13 Phase 4.0). Its few hundred bytes still ship in the
 * client chunk, the same way every "use client" component a Server Component
 * can reach does regardless of the condition around it — Next has no way to
 * know at bundle time whether a server-evaluated env check will render it.
 * `toggleDemoHidden` is unreachable either way with no button to call it from.
 *
 * Sizes are in rem, not the px the task named: a px font-size overrides the
 * user's own browser text setting, which AGENTS.md §2.4/§2.5 forbids outright.
 * 1.25rem and 0.625rem are the same 20px and 10px at a default root, and they
 * still scale when someone has set their text larger.
 */
export function AppHeader() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-muted/40 px-4 py-3">
      <span aria-hidden="true" className="size-[0.625rem] shrink-0 rounded-full bg-accent" />
      <span className="font-display text-xl font-extrabold text-ink">
        {he.common.appName}
      </span>
      {demoMode && <DemoToggleButton />}
    </header>
  );
}
