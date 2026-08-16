// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DanceMap, type DanceMapLabels } from "@/components/DanceMap";
import { resetFavoritesStoreForTests } from "@/lib/favorites/favoritesStore";
import { he } from "@/lib/i18n/he";
import type { MapDance } from "@/lib/maps/mapDance";

/**
 * The preview panel now carries a `FavoriteButton` (Phase 4.5), which needs
 * `next/navigation`'s router — real only inside a Next.js request, never
 * available in a bare RTL render — and the favorites Server Actions, which
 * reach for `cookies()` the same way and would otherwise fail this test for a
 * reason that has nothing to do with what it checks. Neither mock is a
 * simplification of behaviour this suite cares about: what a signed-in
 * dancer's heart does is FavoriteButton.test.tsx's job, not this file's.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/(public)/profile/favoritesActions", () => ({
  getOwnFavoritesAction: vi.fn(() => Promise.resolve({ signedIn: false, favoriteEventIds: [] })),
  addFavoriteAction: vi.fn(),
  removeFavoriteAction: vi.fn(),
}));

/**
 * The map's behaviour that is ours rather than Google's: what happens with no
 * API key, and where focus goes when a pin is chosen and let go of.
 *
 * The Maps library is replaced with a double. That is not an attempt to test
 * Google — it is what makes the parts we wrote reachable at all, since none of
 * the marker or preview code runs until something resolves the loader. Whether
 * a real advanced marker is genuinely focusable and Enter-activatable is
 * Google's documented contract and is checked for real in
 * tests/e2e/home.spec.ts, not here.
 */

const maps = vi.hoisted(() => {
  const created: FakeMarker[] = [];

  class FakeMarker {
    map: unknown = null;
    position: { lat: number; lng: number } | null = null;
    content: HTMLElement | null = null;
    title = "";
    zIndex: number | null = null;
    gmpClickable = false;
    focusCount = 0;
    private handlers: Array<() => void> = [];

    constructor(options: Record<string, unknown> = {}) {
      Object.assign(this, options);
      created.push(this);
    }

    addEventListener(event: string, handler: () => void): void {
      // Recorded by name so a regression back to the legacy "click" event —
      // which does not fire for Enter/Space on a focused marker — shows up as
      // a failing test rather than as a mouse-only map.
      if (event === "gmp-click") this.handlers.push(handler);
    }

    focus(): void {
      this.focusCount += 1;
    }

    /** What Google raises for a tap and, on a focused marker, for Enter/Space. */
    activate(): void {
      for (const handler of this.handlers) handler();
    }
  }

  class FakeMap {
    constructor(
      readonly element: HTMLElement,
      readonly options: Record<string, unknown>,
    ) {}
    setCenter(): void {}
    setZoom(): void {}
    panTo(): void {}
    fitBounds(): void {}
  }

  class FakeBounds {
    extend(): FakeBounds {
      return this;
    }
    isEmpty(): boolean {
      return false;
    }
  }

  return { created, FakeMarker, FakeMap, FakeBounds };
});

vi.mock("@/lib/maps/loadGoogleMaps", () => ({
  loadGoogleMaps: vi.fn(() =>
    Promise.resolve({
      Map: maps.FakeMap,
      AdvancedMarkerElement: maps.FakeMarker,
      LatLngBounds: maps.FakeBounds,
    }),
  ),
}));

const LABELS: DanceMapLabels = {
  regionLabel: "מפת ההרקדות",
  loading: "המפה נטענת…",
  unavailable: "לא הצלחנו להציג את המפה.",
  locate: "הצגת הרקדות לידי",
  locating: "מאתרים…",
  located: "מציג לידך.",
  locateFailed: "לא הצלחנו לאתר אותך.",
  previewLabel: "פרטי ההרקדה שנבחרה",
  previewClose: "סגירת הפרטים",
  previewHint: "בחרו סימון על המפה.",
  navigateShort: "ניווט",
  shareShort: "שיתוף",
  calendarShort: "יומן",
};

function mapDance(overrides: Partial<MapDance> = {}): MapDance {
  return {
    eventId: "event-1",
    occurrenceId: "occurrence-1",
    lat: 32.0114,
    lng: 34.7736,
    venueName: "היכל התרבות חולון",
    time: "20:30",
    weekday: "יום שני",
    timeText: "יום שני, 20:30",
    timeRangeText: "יום שני, 20:30–22:30",
    instructorName: "רונית מרקידה",
    instructorText: "עם רונית מרקידה",
    danceTitle: "הרקדה עם רונית מרקידה",
    status: "scheduled",
    statusLabel: null,
    ringClassName: "border-solid border-accent",
    timeClassName: "",
    statusBadgeClassName: "",
    pinLabel: "הרקדה ביום שני בשעה 20:30, היכל התרבות חולון, עם רונית מרקידה",
    wazeUrl: "https://www.waze.com/ul?ll=32.011400%2C34.773600&navigate=yes",
    wazeLabel: "ניווט להיכל התרבות חולון עם ווייז",
    googleMapsUrl: "https://www.google.com/maps/dir/?api=1&destination=32.011400%2C34.773600",
    googleMapsLabel: "ניווט להיכל התרבות חולון עם גוגל מפות",
    shareUrl: "https://wa.me/?text=test",
    shareLabel: "שיתוף בוואטסאפ",
    icsUrl: "data:text/calendar;charset=utf-8,test",
    icsFilename: "occurrence-1.ics",
    calendarLabel: "הוספה ליומן",
    level: "all_levels",
    danceFormations: [],
    womenOnly: false,
    attributeTags: ["כל הרמות"],
    womenOnlyLabel: null,
    ...overrides,
  };
}

function renderMap(
  props: { apiKey?: string; dances?: MapDance[]; onLocated?: () => void } = {},
) {
  return render(
    <DanceMap
      dances={props.dances ?? [mapDance()]}
      apiKey={props.apiKey ?? "test-key"}
      mapId="TEST_MAP_ID"
      center={{ lat: 32.0809, lng: 34.7806 }}
      locatedRadiusMeters={10_000}
      labels={LABELS}
      onLocated={props.onLocated ?? (() => undefined)}
    />,
  );
}

/**
 * jsdom ships no ResizeObserver, and the component builds its map through one
 * on purpose (docs/decisions/0011) — a container measured at 0x0 leaves the
 * library permanently uninitialised. This stub reports whatever `stubSize` says
 * on the next microtask, and hands each observer's fire function to
 * `resizeFires` so a test can report a later size the way a tab becoming
 * visible would.
 */
let stubSize = { width: 375, height: 325 };
const resizeFires: Array<(width: number, height: number) => void> = [];

class StubResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(): void {
    const fire = (width: number, height: number) => {
      this.callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    };
    resizeFires.push(fire);
    queueMicrotask(() => fire(stubSize.width, stubSize.height));
  }

  unobserve(): void {}
  disconnect(): void {}
}

/** Waits for the loader double to resolve and the markers effect to have run. */
async function markers(): Promise<InstanceType<typeof maps.FakeMarker>[]> {
  await waitFor(() => expect(maps.created.length).toBeGreaterThan(0));
  return maps.created;
}

beforeEach(() => {
  resetFavoritesStoreForTests();
  maps.created.length = 0;
  resizeFires.length = 0;
  stubSize = { width: 375, height: 325 };
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  // jsdom has no idle callback, and the component's setTimeout fallback would
  // make every test wait on a real timer. Running the work immediately keeps
  // the tests about behaviour rather than about scheduling.
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => undefined;
});

afterEach(cleanup);

describe("DanceMap without an API key", () => {
  it("says so in Hebrew instead of leaving an empty box", () => {
    // A blank grey rectangle reads as a broken app to this audience — the
    // reason he.common.screenNotReady exists at all.
    renderMap({ apiKey: "" });

    expect(screen.getByText(LABELS.unavailable)).toBeInTheDocument();
  });

  it("does not render controls that would do nothing without a map", () => {
    // A locate button with no pins to move is a visibly dead control, which is
    // precisely what got the button semantics taken off DanceRing.
    renderMap({ apiKey: "" });

    expect(screen.queryByRole("button", { name: LABELS.locate })).toBeNull();
    expect(screen.queryByText(LABELS.previewHint)).toBeNull();
  });

  it("still labels the region, so the screen's structure is unchanged", () => {
    renderMap({ apiKey: "" });

    expect(screen.getByRole("region", { name: LABELS.regionLabel })).toBeInTheDocument();
  });
});

describe("DanceMap pins", () => {
  it("creates one focusable, clickable marker per dance", async () => {
    renderMap({
      dances: [mapDance(), mapDance({ occurrenceId: "occurrence-2", lat: 32.1 })],
    });

    const created = await markers();
    expect(created).toHaveLength(2);
    // gmpClickable is the single flag that puts a marker in the tab order and
    // makes Enter/Space raise a click. Without it the map is mouse-only.
    expect(created.every((marker) => marker.gmpClickable)).toBe(true);
  });

  it("gives each marker the whole night as its accessible name", async () => {
    const dance = mapDance({
      status: "cancelled",
      pinLabel: "הרקדה ביום שני בשעה 20:30, היכל התרבות חולון, עם רונית מרקידה. בוטל",
    });
    renderMap({ dances: [dance] });

    const [marker] = await markers();
    expect(marker?.title).toBe(dance.pinLabel);
  });

  it("shows a hint rather than a preview until a pin is chosen", () => {
    renderMap();

    expect(screen.getByText(LABELS.previewHint)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: LABELS.previewLabel })).toBeNull();
  });

  it("waits for a laid-out container before building the map", async () => {
    // The regression this guards is silent and nasty: built against a 0x0 box
    // — what a background tab reports, and what a link opened from WhatsApp
    // can land in — the library paints tiles once the box gets its size but
    // never finishes initialising, and not one marker is ever attached.
    stubSize = { width: 0, height: 0 };
    renderMap();

    await waitFor(() => expect(resizeFires.length).toBeGreaterThan(0));
    expect(maps.created).toHaveLength(0);

    // The tab becomes visible and the box finally has a size.
    act(() => resizeFires[resizeFires.length - 1]?.(375, 325));

    await waitFor(() => expect(maps.created.length).toBeGreaterThan(0));
  });
});

describe("DanceMap preview — Phase 4.6c restyle", () => {
  it("shows the dance title, venue, day/time-range and the full action cluster, in order", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    expect(preview).toHaveTextContent(dance.danceTitle);
    expect(preview).toHaveTextContent(dance.venueName);
    expect(preview).toHaveTextContent(dance.timeRangeText);

    // Reading order matters here (AGENTS.md §2 — a keyboard/screen-reader
    // user meets controls in this order): the heading first, then the wide
    // favorite pill, then the three tinted squares, before the Google Maps
    // fallback and the close control.
    const texts = preview.textContent ?? "";
    const order = [
      dance.danceTitle,
      he.favorites.saveShort,
      LABELS.navigateShort,
      LABELS.shareShort,
      LABELS.calendarShort,
      dance.googleMapsLabel,
      LABELS.previewClose,
    ].map((needle) => texts.indexOf(needle));

    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("gives every control in the action cluster a real, focusable element (keyboard reach)", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    // Native <a href> and <button> — no role="link"/"button" simulated on a
    // <div>, and no tabIndex=-1 anywhere in here, which is the whole of what
    // makes Tab reach each one (AGENTS.md §2.7).
    const controls = [
      ...preview.querySelectorAll<HTMLElement>("a[href], button"),
    ];
    expect(controls.length).toBeGreaterThanOrEqual(6); // favorite, waze, share, calendar, googleMaps, close
    for (const control of controls) {
      expect(control.tabIndex).not.toBe(-1);
    }
  });

  it("clears the 48px tap-target floor via min-h-12 on every action control (AGENTS.md §5)", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    for (const link of preview.querySelectorAll("a[href]")) {
      expect(link.className).toContain("min-h-12");
    }
  });

  it("opens with the venue, time, instructor and both navigation links", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();

    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });
    expect(preview).toHaveTextContent(dance.venueName);
    expect(preview).toHaveTextContent(dance.timeText);
    expect(preview).toHaveTextContent(dance.instructorText);

    const waze = screen.getByRole("link", { name: dance.wazeLabel });
    expect(waze).toHaveAttribute("href", dance.wazeUrl);
    expect(screen.getByRole("link", { name: dance.googleMapsLabel })).toHaveAttribute(
      "href",
      dance.googleMapsUrl,
    );
  });

  it("offers a WhatsApp share link and an .ics download (Phase 4.6a)", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    await screen.findByRole("region", { name: LABELS.previewLabel });

    const share = screen.getByRole("link", { name: dance.shareLabel });
    expect(share).toHaveAttribute("href", dance.shareUrl);
    expect(share).toHaveAttribute("target", "_blank");

    const calendar = screen.getByRole("link", { name: dance.calendarLabel });
    expect(calendar).toHaveAttribute("href", dance.icsUrl ?? "");
    expect(calendar).toHaveAttribute("download", dance.icsFilename);
  });

  it("does not offer a calendar entry for a cancelled night", async () => {
    const dance = mapDance({ status: "cancelled", statusLabel: "בוטל", icsUrl: null });
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    await screen.findByRole("region", { name: LABELS.previewLabel });

    expect(screen.queryByRole("link", { name: dance.calendarLabel })).toBeNull();
    // The share link is unaffected — a cancelled night is still worth telling
    // someone about, in words that say it is off.
    expect(screen.getByRole("link", { name: dance.shareLabel })).toBeInTheDocument();
  });

  it("offers Waze before Google Maps (AGENTS.md §9)", async () => {
    const dance = mapDance();
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    await screen.findByRole("region", { name: LABELS.previewLabel });

    // Not links[0]/links[1]: Phase 4.6c's action cluster sits three more
    // links (share, calendar, and Google Maps itself) between the squares
    // and nothing — the guarantee is Waze's DOM position relative to Google
    // Maps specifically, not that they are the only two links in the panel.
    const links = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");
    const wazeIndex = links.findIndex((href) => href.includes("waze.com"));
    const googleMapsIndex = links.findIndex((href) => href.includes("google.com/maps"));
    expect(wazeIndex).toBeGreaterThanOrEqual(0);
    expect(googleMapsIndex).toBeGreaterThan(wazeIndex);
  });

  it("fills the type/level tag slot 4.6c left unused (Phase 4.6b, docs/decisions/0022)", async () => {
    const dance = mapDance({ attributeTags: ["מעגלים", "זוגות", "בינוני"] });
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    expect(preview).toHaveTextContent("מעגלים");
    expect(preview).toHaveTextContent("זוגות");
    expect(preview).toHaveTextContent("בינוני");
  });

  it("shows a dignified women-only badge when the dance is women_only", async () => {
    const dance = mapDance({ womenOnlyLabel: "הרקדה לנשים בלבד" });
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    expect(preview).toHaveTextContent("הרקדה לנשים בלבד");
  });

  it("shows no women-only badge when the dance is not women_only", async () => {
    const dance = mapDance({ womenOnlyLabel: null });
    renderMap({ dances: [dance] });
    const [marker] = await markers();

    marker?.activate();
    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });

    expect(preview).not.toHaveTextContent("הרקדה לנשים בלבד");
  });

  it("states a cancelled dance in words, not by colour (§2.6)", async () => {
    renderMap({ dances: [mapDance({ status: "cancelled", statusLabel: "בוטל" })] });
    const [marker] = await markers();

    marker?.activate();

    expect(
      await screen.findByRole("region", { name: LABELS.previewLabel }),
    ).toHaveTextContent("בוטל");
  });

  it("moves focus to the preview, so a keyboard user lands on what just opened", async () => {
    renderMap();
    const [marker] = await markers();

    marker?.activate();

    const preview = await screen.findByRole("region", { name: LABELS.previewLabel });
    await waitFor(() => expect(document.activeElement).toBe(preview));
  });

  it("returns focus to the pin when the preview is closed", async () => {
    renderMap();
    const [marker] = await markers();
    marker?.activate();
    await screen.findByRole("region", { name: LABELS.previewLabel });
    const before = marker?.focusCount ?? 0;

    screen.getByRole("button", { name: LABELS.previewClose }).click();

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: LABELS.previewLabel })).toBeNull(),
    );
    // Focus goes back where the dancer was, not to the top of the document.
    expect(marker?.focusCount ?? 0).toBeGreaterThan(before);
  });
});

describe("DanceMap location control", () => {
  it("never asks for location on its own (AGENTS.md §9)", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    renderMap();
    await markers();

    // The first render must not block on, or even trigger, a permission prompt.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("asks only when the visible control is pressed", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    renderMap();
    await markers();
    screen.getByRole("button", { name: LABELS.locate }).click();

    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("says so in plain Hebrew when locating fails, and keeps the map working", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
          fail?.({ code: 1, message: "denied" } as GeolocationPositionError),
      },
    });

    renderMap();
    await markers();
    screen.getByRole("button", { name: LABELS.locate }).click();

    expect(await screen.findByText(LABELS.locateFailed)).toBeInTheDocument();
    // Refusing is not an error state: the default region is still on screen.
    expect(screen.getByRole("button", { name: LABELS.locate })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
