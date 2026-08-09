import { AppHeader } from "@/components/AppHeader";
import { TabBar } from "@/components/TabBar";
import { he } from "@/lib/i18n/he";

/**
 * The app shell every public route renders inside: wordmark on top, tab bar on
 * the bottom, screen content scrolling between them.
 *
 * The bar is pinned by making this a viewport-height flex column and giving the
 * middle its own scroll, rather than by `position: fixed` plus bottom padding on
 * the content. Both keep the bar on screen, but the padding version has to
 * hardcode a number equal to the bar's height — and that height is in rem, so it
 * changes the moment someone raises their text size and the number silently
 * stops matching, hiding whatever sits at the end of the page. Here the two
 * regions are siblings that cannot overlap at any text size, which is the
 * property AGENTS.md §2.4 actually asks for.
 *
 * Deliberately NOT `export const dynamic` — a layout-wide declaration would make
 * every route under it per-request by fiat, including any future one that has no
 * reason to be. Each page decides for itself: the map and the schedule declare
 * `force-dynamic` because they read live occurrence rows (docs/decisions/0006),
 * and /profile became dynamic on its own the moment it started reading the session
 * cookie (docs/decisions/0013) — it used to prerender.
 */
export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">{children}</main>
      <TabBar
        navLabel={he.nav.label}
        labels={{
          map: he.nav.map,
          schedule: he.nav.schedule,
          profile: he.nav.profile,
        }}
      />
    </div>
  );
}
