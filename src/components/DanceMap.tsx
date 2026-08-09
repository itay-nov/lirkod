"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps, type GoogleMapsApi } from "@/lib/maps/loadGoogleMaps";
import type { MapDance } from "@/lib/maps/mapDance";
import { PIN_HEIGHT_PX, PIN_WIDTH_PX, pinSvg } from "@/lib/maps/pinAppearance";

export interface DanceMapLabels {
  regionLabel: string;
  loading: string;
  unavailable: string;
  locate: string;
  locating: string;
  located: string;
  locateFailed: string;
  previewLabel: string;
  previewClose: string;
  previewHint: string;
}

/** Roughly a 15km radius on a phone — the default region, framed. */
const REGION_ZOOM = 12;
/** fitBounds on one point zooms to the maximum, which is a street view of one hall. */
const SINGLE_PIN_ZOOM = 15;
/** Enough that a pin anchored at the edge of the bounds is not clipped by its own height. */
const FIT_PADDING_PX = 64;
const GEOLOCATION_TIMEOUT_MS = 10_000;

type Phase = "loading" | "ready" | "unavailable";
type LocateState = "idle" | "locating" | "located" | "failed";

/** Everything about the map that never depends on props or state. */
const MAP_OPTIONS = {
  // Off as a group rather than named one by one: the vector map ships controls
  // (a tilt/rotate puck among them) that no list of individual flags reliably
  // covers, and every one of them is both clutter on a 375px screen and an
  // extra tab stop between a dancer and a pin.
  disableDefaultUI: true,
  // The one exception. Pinch-to-zoom is a gesture, and AGENTS.md §2.7 wants a
  // visible tappable control for anything a gesture can do.
  zoomControl: true,
  // "cooperative", not "greedy": greedy swallows a one-finger drag to pan the
  // map, and the map sits at the top of a page this audience has to scroll to
  // reach the dance list. One finger scrolls the page, two move the map, and
  // the zoom buttons cover the rest.
  gestureHandling: "cooperative",
  // Google's own restaurants and shops are not ours, and tapping one opens
  // Google's popup over the pins that matter.
  clickableIcons: false,
} as const satisfies google.maps.MapOptions;

/**
 * Runs `work` once the browser is idle, and returns a canceller.
 *
 * The point is that it is NOT called during hydration: the map script is a few
 * hundred kilobytes from a third party, and AGENTS.md §2.9 budgets first
 * contentful paint at 2.5s on a mid-range Android. The 2s timeout is the
 * backstop for a device that never goes idle, so a busy phone still gets a map
 * rather than an apology.
 */
function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(work, { timeout: 2_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 200);
  return () => window.clearTimeout(handle);
}

function pinElement(dance: MapDance, selected: boolean): HTMLElement {
  const element = document.createElement("div");
  element.style.width = `${PIN_WIDTH_PX}px`;
  element.style.height = `${PIN_HEIGHT_PX}px`;
  // Without this the inline SVG sits on a text baseline and the descender space
  // below it pushes the pin's tip off the venue by a few pixels.
  element.style.lineHeight = "0";
  // `pinSvg` returns one of a closed set of constants with nothing interpolated
  // into it — see the note on that function. No venue name reaches this.
  element.innerHTML = pinSvg(dance.status, selected);
  return element;
}

/**
 * The hero screen's live map: real pins for the dances the server already
 * queried, a preview panel for the one a dancer picks, and an explicit control
 * that asks for their location.
 *
 * The ONLY client component on this screen, in the same discipline TabBar and
 * DanceRingScroller follow (docs/decisions/0007): the heading, the dance rings
 * and the schedule below it all stay server-rendered. Labels arrive as props
 * rather than by importing `he`, because a bundler cannot tree-shake individual
 * properties off an object literal and that dictionary only grows. Times,
 * statuses and navigation URLs arrive pre-formatted as `MapDance` for the same
 * reason — see `src/lib/maps/mapDance.ts`.
 *
 * Everything here degrades to the region label plus a sentence if the API never
 * loads. The map is an enhancement over the ring list, not a precondition for
 * it, so a missing key or a blocked script must not take the screen down.
 */
export function DanceMap({
  dances: initialDances,
  apiKey,
  mapId,
  center: initialCenter,
  locatedRadiusMeters,
  labels,
}: {
  dances: MapDance[];
  apiKey: string;
  mapId: string;
  center: { lat: number; lng: number };
  locatedRadiusMeters: number;
  labels: DanceMapLabels;
}) {
  // Derived at first render rather than corrected by an effect: a build with no
  // key knows it has no map before it paints, so the honest message is in the
  // server HTML instead of replacing a "loading" flash a moment later. Not
  // thrown, unlike the Supabase client — without dances there is no screen,
  // but without a map there is still the whole list below.
  const [phase, setPhase] = useState<Phase>(apiKey ? "loading" : "unavailable");
  // Separate from `phase`: the API being downloaded and the map being built are
  // two different moments, and markers can only be placed after the second.
  const [mapReady, setMapReady] = useState(false);
  const [dances, setDances] = useState(initialDances);
  const [center, setCenter] = useState(initialCenter);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [locateState, setLocateState] = useState<LocateState>("idle");

  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GoogleMapsApi | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>());
  // Captured once. The map is framed from the real pins the moment it exists,
  // so the constructor's centre is only what shows for that first instant —
  // reading it from a ref keeps it out of the map effect's dependencies, where
  // it would otherwise mean "rebuild the map when the user is located".
  const initialCenterRef = useRef(initialCenter);

  // ---- load ---------------------------------------------------------------

  useEffect(() => {
    if (!apiKey) return;

    let cancelled = false;
    const cancelIdle = whenIdle(() => {
      loadGoogleMaps(apiKey).then(
        (api) => {
          if (cancelled) return;
          apiRef.current = api;
          setPhase("ready");
        },
        () => {
          if (!cancelled) setPhase("unavailable");
        },
      );
    });

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [apiKey]);

  // ---- map instance -------------------------------------------------------

  /**
   * Built through a ResizeObserver rather than straight from the effect body,
   * because the library measures its container once at construction and never
   * recovers if that measurement was zero. A 0x0 container is not a rare case:
   * it is what a background tab reports, and a link opened from WhatsApp — the
   * product's main entry point (AGENTS.md §2.1) — can land in exactly that
   * state. The symptom is nasty precisely because it is silent: tiles paint
   * once the box gets its size, so the map looks fine, but the map never
   * finishes initialising and not one marker is ever attached. Confirmed
   * against a live map reporting renderingType UNINITIALIZED with four created
   * markers and none of them in the document.
   *
   * ResizeObserver fires once on observe with the current size, so this covers
   * the ordinary case in the same code path as the deferred one.
   */
  useEffect(() => {
    if (phase !== "ready" || mapRef.current) return;
    const api = apiRef.current;
    const container = containerRef.current;
    if (!api || !container) return;

    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.contentRect;
      if (!size || size.width === 0 || size.height === 0 || mapRef.current) return;

      mapRef.current = new api.Map(container, {
        ...MAP_OPTIONS,
        mapId,
        center: initialCenterRef.current,
        zoom: REGION_ZOOM,
      });
      observer.disconnect();
      setMapReady(true);
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [phase, mapId]);

  // ---- markers ------------------------------------------------------------

  useEffect(() => {
    const api = apiRef.current;
    const map = mapRef.current;
    if (!mapReady || !api || !map) return;

    const markers = markersRef.current;
    for (const dance of dances) {
      const marker = new api.AdvancedMarkerElement({
        map,
        position: { lat: dance.lat, lng: dance.lng },
        content: pinElement(dance, false),
        // What a screen reader announces for the pin: the whole night in one
        // string, status word included (AGENTS.md §2.6 — never colour alone).
        title: dance.pinLabel,
        // Focusable and Enter/Space-activatable, which is the entire reason a
        // keyboard user can open a preview at all.
        gmpClickable: true,
      });
      // "gmp-click", not "click": the library warns that `click` is its legacy
      // path, and `gmp-click` is what it raises for Enter/Space on a focused
      // marker as well as for a tap. That difference is the whole of keyboard
      // access to the preview.
      marker.addEventListener("gmp-click", () => setSelectedId(dance.occurrenceId));
      markers.set(dance.occurrenceId, marker);
    }

    if (dances.length === 1 && dances[0]) {
      map.setCenter({ lat: dances[0].lat, lng: dances[0].lng });
      map.setZoom(SINGLE_PIN_ZOOM);
    } else if (dances.length > 1) {
      const bounds = new api.LatLngBounds();
      for (const dance of dances) bounds.extend({ lat: dance.lat, lng: dance.lng });
      map.fitBounds(bounds, FIT_PADDING_PX);
    } else {
      // No dances in range: show the region that was searched, so the emptiness
      // reads as "nothing here" rather than as a map that failed to draw.
      map.setCenter(center);
      map.setZoom(REGION_ZOOM);
    }

    return () => {
      for (const marker of markers.values()) marker.map = null;
      markers.clear();
    };
  }, [mapReady, dances, center]);

  // Selection is a separate pass so picking a pin redraws two SVGs instead of
  // tearing down and rebuilding every marker on the map.
  //
  // The SVG inside the content element is replaced, never the element itself.
  // Assigning `marker.content` hands the library a different node to adopt, and
  // doing that in the commit right after the marker was created left every pin
  // constructed but unattached — four markers in our own map, none of them in
  // the document. Mutating in place leaves the node the library is holding
  // exactly where it put it.
  useEffect(() => {
    for (const dance of dances) {
      const marker = markersRef.current.get(dance.occurrenceId);
      const content = marker?.content;
      if (!marker || !(content instanceof HTMLElement)) continue;

      const selected = dance.occurrenceId === selectedId;
      content.innerHTML = pinSvg(dance.status, selected);
      // The chosen pin sits above its neighbours so its halo is never half
      // hidden under the pin next door.
      marker.zIndex = selected ? 1 : null;

      if (selected) {
        // The preview sits below the map rather than in a bubble on it, so
        // nothing else ties the panel to the pin it describes. Without this a
        // pin near the edge — or one a keyboard user tabbed to off-screen —
        // opens a panel about a dance the dancer cannot see on the map.
        mapRef.current?.panTo({ lat: dance.lat, lng: dance.lng });
      }
    }
  }, [dances, selectedId, mapReady]);

  // ---- preview ------------------------------------------------------------

  const selected = dances.find((dance) => dance.occurrenceId === selectedId) ?? null;

  useEffect(() => {
    // Moves the reading position to the panel that just appeared. Without this
    // a keyboard user presses Enter on a pin and focus stays on the map while
    // new content opens somewhere below, out of their reading order.
    if (selectedId) previewRef.current?.focus();
  }, [selectedId]);

  const closePreview = useCallback(() => {
    const marker = selectedId ? markersRef.current.get(selectedId) : null;
    setSelectedId(null);
    // Back to where they came from, rather than dumping focus at the top of the
    // document — the pin still exists, and it is what they were on.
    marker?.focus();
  }, [selectedId]);

  // ---- geolocation --------------------------------------------------------

  const locate = useCallback(() => {
    // Guarded instead of disabling the button: disabling the control a user
    // just pressed blurs it, and the browser drops focus to <body>.
    if (locateState === "locating") return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateState("failed");
      return;
    }

    setLocateState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        // POST, so the dancer's actual position never lands in a URL, browser
        // history or an access log — see the note in the route handler.
        void fetch("/api/dances/near", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...point, radiusMeters: locatedRadiusMeters }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`near query failed: ${response.status}`);
            const payload: unknown = await response.json();
            if (
              typeof payload !== "object" ||
              payload === null ||
              !Array.isArray((payload as { dances?: unknown }).dances)
            ) {
              throw new Error("near query returned an unexpected shape");
            }
            return (payload as { dances: MapDance[] }).dances;
          })
          .then((nearby) => {
            setSelectedId(null);
            setCenter(point);
            setDances(nearby);
            setLocateState("located");
          })
          .catch(() => setLocateState("failed"));
      },
      // Refusal, an unavailable sensor and a timeout are one message: they
      // differ only in a cause the dancer cannot act on, and the screen is
      // left working in all three.
      () => setLocateState("failed"),
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, [locateState, locatedRadiusMeters]);

  const locateMessage =
    locateState === "locating"
      ? labels.locating
      : locateState === "located"
        ? labels.located
        : locateState === "failed"
          ? labels.locateFailed
          : null;

  return (
    <section aria-label={labels.regionLabel} className="flex grow flex-col">
      <div className="relative flex min-h-[40dvh] grow flex-col bg-secondary/15">
        {/*
          Always mounted and always at full size, even while empty. It used to
          be `hidden` until the API arrived, and that shipped a real bug: the
          class flipped to visible in the same commit that created the map, so
          the library measured the element before the browser had laid it out
          and drew a viewport at the wrong size — tiles filling a quarter of the
          box, pins placed against a map that had never been the size it
          appeared. Only a later window resize corrected it. Sized from first
          paint, there is nothing to measure wrongly.

          React renders no children into it, because the library appends its
          own — the loading message is a sibling that paints on top.
        */}
        <div ref={containerRef} className="absolute inset-0" />
        {phase !== "ready" && (
          <p className="relative flex grow items-center justify-center p-4 text-center text-secondary">
            {phase === "loading" ? labels.loading : labels.unavailable}
          </p>
        )}
      </div>

      {/*
        Both the locate control and the preview belong to the map, so neither
        is drawn when there is no map. A "הצגת הרקדות לידי" button with no pins
        to move would be a control that visibly does nothing — the exact fault
        that took the button semantics off DanceRing.
      */}
      {phase === "unavailable" ? null : (
        <>
          <div className="flex flex-col gap-2 px-4 pt-3">
            <button
              type="button"
              onClick={locate}
              aria-busy={locateState === "locating"}
              // Never asked silently on load (AGENTS.md §9): this is the only
              // thing in the app that reaches for the geolocation permission,
              // and a dancer has to press it.
              className="flex min-h-12 items-center justify-center gap-2 self-start rounded-full border-2 border-secondary px-4 py-2 font-semibold text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
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
                <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
                <path d="M12 2l0 3" />
                <path d="M12 19l0 3" />
                <path d="M2 12l3 0" />
                <path d="M19 12l3 0" />
              </svg>
              {labels.locate}
            </button>

            {/*
              polite, not assertive: the outcome matters but it is not urgent,
              and it must not cut across whatever a screen reader is already
              saying. The element is always present so the live region is not
              created and destroyed, which some screen readers miss entirely.
            */}
            <p aria-live="polite" className="min-h-6 text-secondary">
              {locateMessage}
            </p>
          </div>

          {selected === null ? (
            <p className="px-4 pb-1 pt-2 text-secondary">{labels.previewHint}</p>
          ) : (
            <div
              ref={previewRef}
              role="region"
              aria-label={labels.previewLabel}
              // -1 so it can receive focus when a pin is activated, without
              // adding a tab stop of its own on the way past.
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === "Escape") closePreview();
              }}
              className="mx-4 mt-2 flex flex-col gap-3 rounded-2xl border-2 border-secondary bg-surface p-4 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="font-display text-xl font-bold">
                    {selected.venueName}
                  </span>
                  <span>{selected.timeText}</span>
                  <span className="text-secondary">{selected.instructorText}</span>
                </div>
                {selected.statusLabel !== null && (
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 font-bold ${selected.statusBadgeClassName}`}
                  >
                    {selected.statusLabel}
                  </span>
                )}
              </div>

              {/*
                Waze first — it is what this audience drives with in Israel
                (AGENTS.md §9), so it gets the filled treatment and the first
                position. Both are plain links handing off to another app, not
                something we route through ourselves.
              */}
              <a
                href={selected.wazeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center justify-center rounded-full bg-accent px-4 py-2 text-center font-bold text-surface focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
              >
                {selected.wazeLabel}
              </a>
              <a
                href={selected.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-12 items-center justify-center rounded-full border-2 border-secondary px-4 py-2 text-center font-semibold text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
              >
                {selected.googleMapsLabel}
              </a>

              <button
                type="button"
                onClick={closePreview}
                className="flex min-h-12 items-center justify-center rounded-full px-4 py-2 font-semibold text-secondary underline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary"
              >
                {labels.previewClose}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
