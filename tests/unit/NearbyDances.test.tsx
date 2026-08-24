// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NearbyDances, type NearbyDancesLabels } from "@/components/NearbyDances";
import type { DanceMapLabels } from "@/components/DanceMap";
import type { DanceFiltersLabels } from "@/components/DanceFilters";
import type { DistanceFilterLabels } from "@/components/DistanceFilter";
import type { MapDance } from "@/lib/maps/mapDance";

/**
 * The regression this file exists for: pressing "הצגת הרקדות לידי" used to
 * update the map's pins and leave the ring list below rendering the server's
 * default region, so a dancer in Netanya got pins around Netanya above a list
 * still describing Tel Aviv. Two views of one query, disagreeing, with nothing
 * on screen to say which one was right.
 *
 * So the assertions here are deliberately not "the map shows something and the
 * list shows something". They compare the two renderings against each other
 * after a locate: same count, same venues, and neither still carrying the
 * region they started in.
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

    constructor(options: Record<string, unknown> = {}) {
      Object.assign(this, options);
      created.push(this);
    }

    addEventListener(): void {}
    focus(): void {}
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

const MAP_LABELS: DanceMapLabels = {
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

const LABELS: NearbyDancesLabels = {
  heading: "הרקדות קרובות",
  tagline: "מה קורה הערב לידך?",
  empty: "לא נמצאו הרקדות באזור הזה בימים הקרובים.",
  emptyFiltered: "אין הרקדות שמתאימות לסינון שבחרתם.",
  listLabel: "רשימת ההרקדות הקרובות",
  prevLabel: "הרקדות קודמות",
  nextLabel: "הרקדות נוספות",
};

const FILTER_LABELS: DanceFiltersLabels = {
  heading: "סינון הרקדות",
  toggle: "סינון הרקדות",
  close: "סגירת הסינון",
  levelLabel: "רמה",
  anyLevel: "הכול",
  typeLabel: "סוג ההרקדה",
  womenOnlyLabel: "רק הרקדות לנשים בלבד",
  levelOptions: [
    { value: "beginner", label: "מתחילים" },
    { value: "intermediate", label: "בינוני" },
    { value: "advanced", label: "מתקדמים" },
    { value: "all_levels", label: "כל הרמות" },
  ],
  formationOptions: [
    { value: "circle", label: "מעגלים" },
    { value: "couples", label: "זוגות" },
    { value: "line", label: "ליין" },
    { value: "mixed", label: "מעורב" },
  ],
};

const DISTANCE_LABELS: DistanceFilterLabels = {
  legend: "מרחק לחיפוש",
  options: [
    { radiusMeters: 5_000, label: "עד 5 ק״מ" },
    { radiusMeters: 15_000, label: "עד 15 ק״מ" },
    { radiusMeters: 30_000, label: "עד 30 ק״מ" },
    { radiusMeters: 50_000, label: "עד 50 ק״מ" },
  ],
  updating: "מעדכנים",
  updateFailed: "לא הצלחנו לעדכן",
};

const DEFAULT_VENUE = "היכל התרבות חולון";
const LOCATED_VENUES = ["אולם נתניה", "מרכז קהילתי הרצליה"];

function dance(venueName: string, overrides: Partial<MapDance> = {}): MapDance {
  return {
    eventId: `event-${venueName}`,
    occurrenceId: `occurrence-${venueName}`,
    lat: 32.0114,
    lng: 34.7736,
    venueName,
    time: "20:30",
    weekday: "יום שני",
    timeText: "יום שני, 20:30",
    timeRangeText: "יום שני, 20:30–22:30",
    instructorName: "רונית מרקידה",
    instructorText: "עם רונית מרקידה",
    danceTitle: `הרקדה עם רונית מרקידה`,
    status: "scheduled",
    statusLabel: null,
    ringClassName: "border-solid border-accent",
    timeClassName: "",
    statusBadgeClassName: "",
    // The pin's accessible name carries the venue, which is what lets the
    // assertions below read a marker and a list row as describing one dance.
    pinLabel: `הרקדה ביום שני בשעה 20:30, ${venueName}, עם רונית מרקידה`,
    wazeUrl: "https://www.waze.com/ul?ll=32.011400%2C34.773600&navigate=yes",
    wazeLabel: `ניווט ל${venueName} עם ווייז`,
    googleMapsUrl: "https://www.google.com/maps/dir/?api=1&destination=32.011400%2C34.773600",
    googleMapsLabel: `ניווט ל${venueName} עם גוגל מפות`,
    shareUrl: "https://wa.me/?text=test",
    shareLabel: "שיתוף בוואטסאפ",
    icsUrl: "data:text/calendar;charset=utf-8,test",
    icsFilename: `occurrence-${venueName}.ics`,
    calendarLabel: "הוספה ליומן",
    level: "all_levels",
    danceFormations: [],
    womenOnly: false,
    attributeTags: ["כל הרמות"],
    womenOnlyLabel: null,
    ...overrides,
  };
}

let stubSize = { width: 375, height: 325 };

class StubResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    queueMicrotask(() =>
      this.callback(
        [{ contentRect: stubSize } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Markers the map is currently showing. `created` accumulates every marker ever
 * built, and the marker effect's cleanup detaches the old ones by nulling
 * `map` — so filtering on that is the difference between "what is on the map"
 * and "what has ever been on it".
 */
function livePins(): InstanceType<typeof maps.FakeMarker>[] {
  return maps.created.filter((marker) => marker.map !== null);
}

function ringList() {
  return screen.getByRole("list", { name: LABELS.listLabel });
}

function renderScreen(initialDances: MapDance[]) {
  return render(
    <NearbyDances
      initialDances={initialDances}
      initialCenter={{ lat: 32.0809, lng: 34.7806 }}
      initialRadiusMeters={15_000}
      apiKey="test-key"
      mapId="TEST_MAP_ID"
      mapLabels={MAP_LABELS}
      distanceFilterLabels={DISTANCE_LABELS}
      filterLabels={FILTER_LABELS}
      labels={LABELS}
    />,
  );
}

function stubQuerySucceedingWith(dances: MapDance[]) {
  const fetchMock = vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ dances }),
    } as Response),
  );
  vi.stubGlobal(
    "fetch",
    fetchMock,
  );
  return fetchMock;
}

function responseWith(dances: MapDance[], json = vi.fn(() => Promise.resolve({ dances }))) {
  return {
    response: { ok: true, json } as unknown as Response,
    json,
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function stubGeolocationSucceeding() {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (onSuccess: PositionCallback) =>
        onSuccess({
          coords: { latitude: 32.3215, longitude: 34.8532 },
        } as GeolocationPosition),
    },
  });
}

/** Grants location and answers the route handler with `located`. */
function stubLocateSucceedingWith(located: MapDance[]) {
  stubGeolocationSucceeding();
  return stubQuerySucceedingWith(located);
}

beforeEach(() => {
  maps.created.length = 0;
  stubSize = { width: 375, height: 325 };
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    callback({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NearbyDances before anyone is located", () => {
  it("draws the server's dances as both pins and rings", async () => {
    renderScreen([dance(DEFAULT_VENUE)]);

    await waitFor(() => expect(livePins()).toHaveLength(1));
    expect(livePins()[0]?.title).toContain(DEFAULT_VENUE);
    expect(ringList()).toHaveTextContent(DEFAULT_VENUE);
  });

  it("re-queries the current centre with the chosen radius and updates pins and rings", async () => {
    const widenedVenue = "אולם במרחק שלושים קילומטר";
    const fetchMock = stubQuerySucceedingWith([dance(widenedVenue)]);
    renderScreen([dance(DEFAULT_VENUE)]);
    await waitFor(() => expect(livePins()).toHaveLength(1));

    screen.getByRole("radio", { name: "עד 30 ק״מ" }).click();

    await waitFor(() => expect(ringList()).toHaveTextContent(widenedVenue));
    await waitFor(() => expect(livePins()[0]?.title).toContain(widenedVenue));
    expect(ringList()).not.toHaveTextContent(DEFAULT_VENUE);

    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      lat: 32.0809,
      lng: 34.7806,
      radiusMeters: 30_000,
    });
  });
});

describe("NearbyDances after a successful locate", () => {
  it("moves the ring list to the located region, not just the pins", async () => {
    stubLocateSucceedingWith(LOCATED_VENUES.map((venue) => dance(venue)));
    renderScreen([dance(DEFAULT_VENUE)]);
    await waitFor(() => expect(livePins()).toHaveLength(1));

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();
    await screen.findByText(MAP_LABELS.located);

    // The list is the half that used to be left behind.
    for (const venue of LOCATED_VENUES) {
      await waitFor(() => expect(ringList()).toHaveTextContent(venue));
    }
    expect(ringList()).not.toHaveTextContent(DEFAULT_VENUE);
  });

  it("leaves the pins and the list describing the same dances", async () => {
    stubLocateSucceedingWith(LOCATED_VENUES.map((venue) => dance(venue)));
    renderScreen([dance(DEFAULT_VENUE)]);
    await waitFor(() => expect(livePins()).toHaveLength(1));

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();
    await waitFor(() => expect(livePins()).toHaveLength(LOCATED_VENUES.length));

    // Compared against each other rather than each against the fixture: this is
    // the assertion that fails if one view is refreshed and the other is not.
    const rows = within(ringList()).getAllByRole("listitem");
    const pins = livePins();
    expect(pins).toHaveLength(rows.length);

    for (const [index, row] of rows.entries()) {
      const venue = LOCATED_VENUES[index];
      expect(venue).toBeDefined();
      // Same dance, same position in both, read out of two independent
      // renderings — the DOM for the row, the marker's own accessible name.
      expect(row).toHaveTextContent(venue ?? "");
      expect(pins[index]?.title).toContain(venue ?? "");
    }

    // And the region they both started in is gone from both.
    expect(ringList()).not.toHaveTextContent(DEFAULT_VENUE);
    expect(pins.some((pin) => pin.title.includes(DEFAULT_VENUE))).toBe(false);
  });

  it("tells a dancer with nothing nearby, instead of leaving the old list up", async () => {
    // An empty located result is the sharpest version of the bug: the map goes
    // blank while a stale list still lists dances 40km away.
    stubLocateSucceedingWith([]);
    renderScreen([dance(DEFAULT_VENUE)]);
    await waitFor(() => expect(livePins()).toHaveLength(1));

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();

    expect(await screen.findByText(LABELS.empty)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: LABELS.listLabel })).toBeNull();
    await waitFor(() => expect(livePins()).toHaveLength(0));
  });

  it("applies a later distance change around the located centre", async () => {
    const fetchMock = stubLocateSucceedingWith(
      LOCATED_VENUES.map((venue) => dance(venue)),
    );
    renderScreen([dance(DEFAULT_VENUE)]);

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();
    await screen.findByText(MAP_LABELS.located);

    const widerVenue = "אולם רחוק יותר מנתניה";
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ dances: [dance(widerVenue)] }),
    } as Response);
    screen.getByRole("radio", { name: "עד 30 ק״מ" }).click();

    await waitFor(() => expect(ringList()).toHaveTextContent(widerVenue));
    const request = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({
      lat: 32.3215,
      lng: 34.8532,
      radiusMeters: 30_000,
    });
  });
});

describe("NearbyDances with overlapping proximity requests", () => {
  it("does not let an older radius response overwrite a newer located region", async () => {
    stubGeolocationSucceeding();
    const radiusRequest = deferredResponse();
    const locateRequest = deferredResponse();
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(radiusRequest.promise)
      .mockReturnValueOnce(locateRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderScreen([dance(DEFAULT_VENUE)]);

    screen.getByRole("radio", { name: "עד 30 ק״מ" }).click();
    screen.getByRole("button", { name: MAP_LABELS.locate }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    locateRequest.resolve(responseWith([dance(LOCATED_VENUES[0] ?? "")]).response);
    await screen.findByText(MAP_LABELS.located);
    await waitFor(() => expect(ringList()).toHaveTextContent(LOCATED_VENUES[0] ?? ""));

    const stale = responseWith([dance("תוצאה ישנה מהמרכז הקבוע")]);
    radiusRequest.resolve(stale.response);
    await waitFor(() => expect(stale.json).toHaveBeenCalled());
    expect(ringList()).toHaveTextContent(LOCATED_VENUES[0] ?? "");
    expect(ringList()).not.toHaveTextContent("תוצאה ישנה מהמרכז הקבוע");
  });

  it("does not let an older locate response overwrite a newer radius result", async () => {
    stubGeolocationSucceeding();
    const locateRequest = deferredResponse();
    const radiusRequest = deferredResponse();
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(locateRequest.promise)
      .mockReturnValueOnce(radiusRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderScreen([dance(DEFAULT_VENUE)]);

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();
    screen.getByRole("radio", { name: "עד 30 ק״מ" }).click();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    radiusRequest.resolve(responseWith([dance("התוצאה האחרונה שביקשו")]).response);
    await waitFor(() => expect(ringList()).toHaveTextContent("התוצאה האחרונה שביקשו"));

    const stale = responseWith([dance(LOCATED_VENUES[0] ?? "")]);
    locateRequest.resolve(stale.response);
    await waitFor(() => expect(stale.json).toHaveBeenCalled());
    expect(ringList()).toHaveTextContent("התוצאה האחרונה שביקשו");
    expect(ringList()).not.toHaveTextContent(LOCATED_VENUES[0] ?? "");
    expect(screen.queryByText(MAP_LABELS.located)).toBeNull();
  });
});

describe("NearbyDances when locating fails", () => {
  it("keeps the default region on both views", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, onError?: PositionErrorCallback) =>
          onError?.({ code: 1, message: "denied" } as GeolocationPositionError),
      },
    });
    renderScreen([dance(DEFAULT_VENUE)]);
    await waitFor(() => expect(livePins()).toHaveLength(1));

    screen.getByRole("button", { name: MAP_LABELS.locate }).click();

    expect(await screen.findByText(MAP_LABELS.locateFailed)).toBeInTheDocument();
    // Refusing is not an error state: both views still show what they had.
    expect(ringList()).toHaveTextContent(DEFAULT_VENUE);
    expect(livePins()[0]?.title).toContain(DEFAULT_VENUE);
  });
});
