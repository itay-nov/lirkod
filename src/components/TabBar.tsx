"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActiveTab } from "@/lib/domain/navigation";

export interface TabBarLabels {
  map: string;
  schedule: string;
  profile: string;
}

/**
 * Stroke icons inlined rather than pulled from an icon package: the project has
 * no icon dependency, and AGENTS.md §13 says not to add one for something the
 * stack already does. None of the three implies a direction, so unlike the
 * scroller's chevrons there is nothing here to mirror for RTL (§7).
 */
const TABS: ReadonlyArray<{
  key: keyof TabBarLabels;
  href: string;
  iconPaths: readonly string[];
}> = [
  {
    key: "map",
    href: "/",
    iconPaths: [
      "M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
      "M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z",
    ],
  },
  {
    key: "schedule",
    href: "/schedule",
    iconPaths: [
      "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z",
      "M16 3v4",
      "M8 3v4",
      "M4 11h16",
    ],
  },
  {
    key: "profile",
    href: "/profile",
    iconPaths: [
      "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0",
      "M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
    ],
  },
];

/**
 * Bottom navigation. Three real routes, reached with `next/link` — not client
 * state pretending to be navigation — so the URL, browser back/forward, refresh,
 * and a link pasted into WhatsApp all behave (AGENTS.md §2.1).
 *
 * Favorites was a fourth tab and route in the first pass of this shell; it is
 * now a section inside /profile instead of its own destination (see the comment
 * in that page for why), which is also why a three-item bar no longer wraps a
 * label at 200% text on a 375px phone the way four did.
 *
 * The only client boundary in the shell, and only because the active tab has to
 * follow the real path. Everything above it stays server-rendered; the labels
 * arrive as props so the whole `he` dictionary is not dragged into the client
 * bundle, the same split DanceRingScroller already uses (§2.9, §13).
 */
export function TabBar({
  navLabel,
  labels,
}: {
  navLabel: string;
  labels: TabBarLabels;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={navLabel}
      className="shrink-0 border-t border-muted/40 bg-surface"
    >
      <ul className="flex justify-between">
        {TABS.map(({ key, href, iconPaths }) => {
          const active = isActiveTab(pathname, href);

          return (
            // NOT flex-1 (equal thirds) any more, since Phase 4.1: "אזור אישי"
            // needs ~146px on one line at 200% text, and an equal column here
            // is only 125px even with zero padding — "מפה" and "לוח" were
            // sitting on ~55px and ~74px of unused width in their own equal
            // thirds the whole time. `justify-between` gives each tab its own
            // content width and spreads the leftover as gaps instead, which is
            // what actually fits — content here (all three labels, both icons,
            // all padding) sums to well under 375px, so this does not
            // reintroduce the four-tab bug (docs/decisions/0007) it looks
            // similar to: that one had labels wider than an EQUAL column with
            // no natural break point; this one has one label that is wider
            // than an equal column but not wider than the bar.
            //
            // min-w-12 (48px, AGENTS.md §5's tap target floor) replaces the
            // old min-w-0: that one existed to let a forced-equal flex-1
            // column shrink below its label's intrinsic width. There is no
            // forced-equal column any more (see the note on `justify-between`
            // above), so the risk flipped — "מפה", the shortest label,
            // measured under 48px wide once it was sized to its own content
            // instead of a third of the bar. This is the explicit floor that
            // an equal-width column used to provide for free.
            <li key={href} className="min-w-12">
              <Link
                href={href}
                // Only on the active tab, so a screen reader announces "current
                // page" instead of leaving the user to infer it from a colour.
                aria-current={active ? "page" : undefined}
                // min-h-12 is the 48px floor (AGENTS.md §5) stated explicitly
                // rather than left to whatever the icon and label happen to add
                // up to. In rem, so it grows with the text instead of clipping.
                className={`flex min-h-12 flex-col items-center justify-center gap-1 px-1 py-2 focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-secondary ${
                  // Inactive is --color-secondary, NOT --color-muted: muted is
                  // 3.6:1 on surface and fails the 4.5:1 text minimum (see the
                  // token table in globals.css). Secondary is the muted-relative
                  // -to-accent tone that still passes, at 8.9:1.
                  active ? "text-accent" : "text-secondary"
                }`}
              >
                {/*
                  The bar above the active tab, plus the bolder label below, are
                  what keep this from being state carried by colour alone
                  (AGENTS.md §2.6) — presence/absence of a shape reads without
                  colour vision, and survives a greyscale screenshot.
                */}
                <span
                  aria-hidden="true"
                  className={`h-1 w-8 rounded-full ${active ? "bg-accent" : "bg-transparent"}`}
                />
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="size-6 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {iconPaths.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
                {/*
                  Every tab carries its Hebrew word, never an icon on its own —
                  a pictogram is a guess, and this audience should not have to
                  make one (AGENTS.md §2).
                */}
                {/*
                  overflow-wrap:anywhere, not break-words: only `anywhere` is
                  counted when the browser computes min-content width, so only
                  `anywhere` actually lets the tab narrow. A single Hebrew word
                  has no space to wrap at, so at 200% on a narrow phone this is
                  what stands between a readable label and a sideways-scrolling
                  page. It never triggers at normal sizes — the word fits.
                */}
                <span
                  className={`text-center [overflow-wrap:anywhere] ${active ? "font-bold" : ""}`}
                >
                  {labels[key]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
