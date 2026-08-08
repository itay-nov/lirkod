import { he } from "@/lib/i18n/he";

/**
 * The slim top bar: an accent dot beside the wordmark.
 *
 * A Server Component with no interactivity — it is not a link back to the map,
 * because the map already has its own tab in TabBar and two different controls
 * for one destination is a thing to explain rather than a thing to use
 * (AGENTS.md §2).
 *
 * Sizes are in rem, not the px the task named: a px font-size overrides the
 * user's own browser text setting, which AGENTS.md §2.4/§2.5 forbids outright.
 * 1.25rem and 0.625rem are the same 20px and 10px at a default root, and they
 * still scale when someone has set their text larger.
 */
export function AppHeader() {
  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-muted/40 px-4 py-3">
      <span aria-hidden="true" className="size-[0.625rem] shrink-0 rounded-full bg-accent" />
      <span className="font-display text-xl font-extrabold text-ink">
        {he.common.appName}
      </span>
    </header>
  );
}
