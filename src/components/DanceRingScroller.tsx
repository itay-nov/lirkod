"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * Sub-pixel rounding and scroll-snap settling mean scrollLeft rarely lands on
 * an exact 0 or -(scrollWidth - clientWidth); treat anything this close as
 * "there" so the controls don't get stuck one pixel short of disabled.
 */
const EDGE_EPSILON_PX = 2;

function readEdges(el: HTMLElement): { atStart: boolean; atEnd: boolean } {
  const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
  // RTL: every evergreen engine implements the CSSOM View convention where
  // scrollLeft is 0 at the start (the right edge, since content begins on the
  // right) and goes negative toward the end (the left edge) — the opposite of
  // LTR. Confirmed against this app's own layout, not assumed from spec text.
  return {
    atStart: el.scrollLeft >= -EDGE_EPSILON_PX,
    atEnd: el.scrollLeft <= -maxScroll + EDGE_EPSILON_PX,
  };
}

/**
 * Wraps the horizontally-scrolling dance ring list with prev/next controls
 * (AGENTS.md §2.7 — swipe/scroll alone is not a valid way to reach content;
 * there must be a tappable control too). The peek-and-swipe affordance on the
 * rings themselves is untouched; this adds a second, explicit way to move.
 *
 * The only client-side piece of the hero screen — DanceRing itself stays a
 * server-rendered, JS-free component, passed in as `children` and never
 * re-implemented here, so the §2.9 performance budget only pays for two
 * buttons' worth of interactivity, not the whole list.
 */
export function DanceRingScroller({
  listLabel,
  prevLabel,
  nextLabel,
  children,
}: {
  listLabel: string;
  prevLabel: string;
  nextLabel: string;
  children: React.ReactNode;
}) {
  const scrollerRef = useRef<HTMLUListElement>(null);
  const prevButtonRef = useRef<HTMLButtonElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  // atStart defaults true because the list always starts scrolled to exactly
  // that position. atEnd defaults false (a guess that there IS more to scroll
  // to) rather than true, so a short list that turns out to fit entirely just
  // means "next" self-corrects to disabled a tick later, instead of every
  // normal list flashing a wrongly-disabled "next" on first paint.
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const edges = readEdges(el);
    setAtStart(edges.atStart);
    setAtEnd(edges.atEnd);
  }, []);

  // Reconciles two things button clicks can't predict on their own: the list
  // fitting without overflow at all, and a user swiping the list directly
  // (the affordance this component is additive to, not a replacement for).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    syncEdges();
    el.addEventListener("scroll", syncEdges, { passive: true });
    window.addEventListener("resize", syncEdges);
    return () => {
      el.removeEventListener("scroll", syncEdges);
      window.removeEventListener("resize", syncEdges);
    };
  }, [syncEdges]);

  function scrollByPage(direction: "prev" | "next") {
    const el = scrollerRef.current;
    if (!el) return;

    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
    // +clientWidth moves scrollLeft toward 0 (the start, visually right);
    // -clientWidth moves it toward -maxScroll (the end, visually left) — see
    // the RTL note in readEdges.
    const delta = direction === "prev" ? el.clientWidth : -el.clientWidth;
    const target = Math.min(0, Math.max(-maxScroll, el.scrollLeft + delta));

    // "instant", not "smooth": a mid-flight smooth-scroll animation fires many
    // intermediate 'scroll' events, each with a genuinely not-yet-arrived
    // scrollLeft. The reconciliation listener below would read those and
    // overwrite the correct prediction just set below with "not at the edge
    // yet" — next flickers back to enabled for the ~300ms the animation runs,
    // which is exactly the window a screen reader or a slow tap lands in.
    // Confirmed by tracing actual scrollLeft/disabled values frame-by-frame
    // against a running instance — this isn't a guess.
    el.scrollTo({ left: target, behavior: "instant" });

    // Computed now, from the target we just chose, rather than read back from
    // the DOM once the animation finishes. A disabled button cannot hold
    // focus — the moment `disabled` becomes true on the button the user just
    // pressed, the browser blurs it to nothing. Deciding this synchronously,
    // before that happens, is what lets focus move to the sibling control
    // instead of vanishing.
    const willBeAtStart = target >= -EDGE_EPSILON_PX;
    const willBeAtEnd = target <= -maxScroll + EDGE_EPSILON_PX;

    // flushSync, not a plain setState: on a short list one page-scroll can
    // clear BOTH edges in a single click (leaving start and reaching end at
    // once). Without forcing the commit here, the sibling button's `disabled`
    // attribute is still true in the live DOM at the moment `.focus()` below
    // runs — focusing a genuinely disabled element is a silent no-op, so
    // "next" keeps focus, React then disables IT on the next render, and the
    // browser blurs it to <body> with no button focused at all.
    flushSync(() => {
      setAtStart(willBeAtStart);
      setAtEnd(willBeAtEnd);
    });

    if (direction === "prev" && willBeAtStart) {
      nextButtonRef.current?.focus();
    } else if (direction === "next" && willBeAtEnd) {
      prevButtonRef.current?.focus();
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-4 pt-3">
        {/*
          First in reading order sits at the right in this RTL layout (the
          start), which is naturally where "previous" belongs; "next" follows
          to its left. AGENTS.md §7 — the icons are mirrored for RTL, not
          borrowed as-is from an LTR convention: here "back" points right and
          "forward" points left, the reverse of an LTR UI.
        */}
        <button
          ref={prevButtonRef}
          type="button"
          onClick={() => scrollByPage("prev")}
          disabled={atStart}
          aria-disabled={atStart}
          aria-label={prevLabel}
          aria-controls="dance-ring-list"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-secondary text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:border-muted disabled:text-muted"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          ref={nextButtonRef}
          type="button"
          onClick={() => scrollByPage("next")}
          disabled={atEnd}
          aria-disabled={atEnd}
          aria-label={nextLabel}
          aria-controls="dance-ring-list"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-secondary text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:border-muted disabled:text-muted"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>

      <ul
        id="dance-ring-list"
        ref={scrollerRef}
        aria-label={listLabel}
        // pb-2 is not decoration: overflow-x-auto clips overflow on BOTH
        // axes, and without it the focused ring's 4px outline is sliced off
        // at the bottom of the scroller.
        className="flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 pt-4"
      >
        {children}
      </ul>
    </div>
  );
}
