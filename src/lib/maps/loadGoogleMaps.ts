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
 * A hung request is indistinguishable from a slow one to a promise, and the
 * difference matters here: without this the map area sits on "המפה נטענת…"
 * for ever when the script is blocked by a network filter or an extension,
 * which reads as a broken app. Rejecting lets the UI say so and point at the
 * list below, which has the same dances.
 */
const LOAD_TIMEOUT_MS = 15_000;

let pending: Promise<GoogleMapsApi> | null = null;

function injectScript(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      reject(new Error("Google Maps script tag already present but the API never arrived"));
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

    window.__lirkodGoogleMapsReady = () => {
      delete window.__lirkodGoogleMapsReady;
      resolve();
    };

    script.onerror = () => {
      delete window.__lirkodGoogleMapsReady;
      script.remove();
      reject(new Error("Google Maps script failed to load"));
    };

    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    document.head.appendChild(script);
  });
}

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

async function load(apiKey: string): Promise<GoogleMapsApi> {
  await injectScript(apiKey);

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
 * Memoised: several callers (or a re-mount in development) share one script
 * tag and one download. A failure clears the memo so a retry is possible —
 * caching a rejection would make one flaky network moment permanent for the
 * life of the page.
 */
export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (pending) return pending;

  pending = withTimeout(load(apiKey)).catch((error: unknown) => {
    pending = null;
    throw error;
  });

  return pending;
}
