/**
 * Fetches the Google Maps JavaScript API, once, on demand.
 *
 * Deliberately not a `<script>` in the document head and not `next/script` with
 * a pre-hydration strategy: the API is several hundred kilobytes of third-party
 * JavaScript, and AGENTS.md §2.9 puts first contentful paint under 2.5s on a
 * mid-range Android over 4G. The map page renders its own markup first and
 * calls this afterwards (see `DanceMap`), so nothing Google ships is on the
 * critical path — the heading, the dance rings and the tab bar are all painted
 * and usable before the request goes out.
 *
 * Browser-only by construction: it appends to `document`.
 */

export interface GoogleMapsApi {
  Map: typeof google.maps.Map;
  AdvancedMarkerElement: typeof google.maps.marker.AdvancedMarkerElement;
  LatLngBounds: typeof google.maps.LatLngBounds;
}

const SCRIPT_ID = "google-maps-js-api";

/**
 * How long a caller waits before giving up and letting the UI say the map is
 * unavailable. A hung request is indistinguishable from a slow one to a
 * promise, and without this the map area sits on "המפה נטענת…" for ever when
 * the script is blocked by a network filter or an extension, which reads as a
 * broken app.
 *
 * It bounds the WAIT, not the download. That distinction is the whole of the
 * fix below: this audience is explicitly assumed to be on slow connections
 * (AGENTS.md §2.9), so a script that needs 18 seconds is an ordinary Tuesday
 * here, not an edge case, and giving up on it must not also destroy it.
 */
const LOAD_TIMEOUT_MS = 15_000;

/**
 * The script's own load, memoised for the life of the page.
 *
 * Deliberately separate from `apiLoad` below. A caller that times out clears
 * only its own memo, so the next attempt attaches to *this* promise — the
 * download that was already most of the way there — instead of starting over
 * or, as it used to, failing instantly for ever.
 */
let scriptLoad: Promise<void> | null = null;

/** The combined result callers see. Cleared on any failure so a retry re-runs. */
let apiLoad: Promise<GoogleMapsApi> | null = null;

/** True once the API has finished bootstrapping, whoever started it. */
function apiReady(): boolean {
  return typeof google !== "undefined" && typeof google.maps?.importLibrary === "function";
}

function loadScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const failed = () => {
      delete window.__lirkodGoogleMapsReady;
      document.getElementById(SCRIPT_ID)?.remove();
      reject(new Error("Google Maps script failed to load"));
    };

    // Registered before the tag is appended, and re-registered when adopting an
    // existing one, because the API calls this global by name once it has
    // finished initialising — which is later than the script's own `load`.
    window.__lirkodGoogleMapsReady = () => {
      delete window.__lirkodGoogleMapsReady;
      resolve();
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      // A tag left by an attempt whose caller stopped waiting. Adopting it is
      // the point: the download is in flight, and a second copy of a
      // several-hundred-kilobyte script on a connection already too slow to
      // finish the first one is the worst thing we could do to this dancer.
      existing.addEventListener("error", failed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;

    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      // Google's own chrome — zoom button tooltips, the "use two fingers to
      // move the map" toast, place labels — renders in this language. Left at
      // the default it would put English words on a Hebrew screen, which
      // AGENTS.md §2.8 rules out even when the words are not ours.
      language: "he",
      region: "IL",
      // Tells the API it was loaded asynchronously, which is what lets us pull
      // individual libraries with importLibrary instead of naming them all up
      // front and paying for the ones we do not use.
      loading: "async",
      callback: "__lirkodGoogleMapsReady",
    });

    script.onerror = failed;

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    document.head.appendChild(script);
  });
}

/**
 * The script load, started at most once and shared by every caller.
 *
 * A rejection — a blocked host, a dead network, a bad key host — clears the
 * memo so the next attempt injects a fresh tag. A caller-side timeout does not
 * come through here at all, which is exactly why a slow load survives one.
 */
function ensureScript(apiKey: string): Promise<void> {
  if (apiReady()) return Promise.resolve();

  if (!scriptLoad) {
    scriptLoad = loadScript(apiKey);
    scriptLoad.catch(() => {
      scriptLoad = null;
    });
  }

  return scriptLoad;
}

/**
 * Stops waiting after `LOAD_TIMEOUT_MS` without touching `work`.
 *
 * `work` keeps running. That is the difference between "this dancer sees the
 * fallback now" and "this browser can never load a map again": the previous
 * version rejected and left the injected tag and its pending callback behind,
 * so the next mount found a stale script and failed instantly — even when the
 * original download would have finished a second later.
 */
function withTimeout<T>(work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Google Maps did not load within ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function importLibraries(): Promise<GoogleMapsApi> {
  // Three separate libraries rather than `libraries=core,maps,marker` on the
  // URL: importLibrary is the documented path under `loading=async`, and it
  // keeps what we depend on visible right here instead of encoded in a query
  // string. They resolve from one already-downloaded bundle, so this is not
  // three round trips.
  const [{ LatLngBounds }, { Map }, { AdvancedMarkerElement }] = await Promise.all([
    google.maps.importLibrary("core"),
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("marker"),
  ]);

  return { Map, AdvancedMarkerElement, LatLngBounds };
}

/**
 * Memoised: several callers (or a re-mount in development) share one script tag
 * and one download. A failure clears this memo so a retry is possible — caching
 * a rejection would make one flaky network moment permanent for the life of the
 * page.
 *
 * What a retry after a timeout actually does now: `apiLoad` is gone, so this
 * runs again; `ensureScript` finds the *same* in-flight script promise (or an
 * already-finished API) and attaches to it, with a fresh timeout window. On a
 * slow connection the second attempt usually resolves immediately, because the
 * download it is waiting on has had another 15 seconds to finish.
 *
 * Nothing retries on its own inside a single mount. The retry path today is a
 * remount — tabbing away from the map and back — which is worth knowing when
 * reading the "לא הצלחנו להציג את המפה" state: it is not permanent.
 */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (apiLoad) return apiLoad;

  apiLoad = withTimeout(ensureScript(apiKey).then(importLibraries)).catch(
    (error: unknown) => {
      apiLoad = null;
      throw error;
    },
  );

  return apiLoad;
}
