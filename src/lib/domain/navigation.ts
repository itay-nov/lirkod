/**
 * Which tab the current URL belongs to.
 *
 * Lives here rather than inside TabBar because it is a rule, not a rendering
 * detail: it decides what `aria-current="page"` announces, and a screen reader
 * user who is told they are on the wrong screen has no other cue to correct it.
 * Pure and DOM-free so it is testable without jsdom and survives the Capacitor
 * wrap (AGENTS.md §3).
 */

/**
 * `/` matches only itself — a `startsWith` test would make the map tab active on
 * every route in the app, since every path starts with "/". Every other tab also
 * matches its own subtree, so a future `/schedule/2026-03-01` still lights up
 * "לוח" rather than nothing at all.
 */
export function isActiveTab(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
