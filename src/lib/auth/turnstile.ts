/**
 * Fetches Cloudflare Turnstile's script, once, on demand.
 *
 * Same shape and the same reasoning as `src/lib/maps/loadGoogleMaps.ts`: third-party
 * JavaScript stays off the critical path and is requested by the component that
 * needs it, after that component has rendered its own markup. Here it matters less
 * than it does for the map — /profile is not the hero screen — but a dancer who
 * opens their profile and is not signing in should not pay for a challenge widget
 * either (AGENTS.md §2.9).
 *
 * Browser-only by construction: it appends to `document`.
 */

const SCRIPT_ID = "cloudflare-turnstile";

/**
 * Long enough for a genuinely slow connection (AGENTS.md §2.9 assumes one), short
 * enough that a blocked host does not leave the sign-in button disabled for ever.
 * A dancer whose network filter eats challenges.cloudflare.com needs to be told
 * that sign-in is unavailable, not left watching a spinner.
 */
const LOAD_TIMEOUT_MS = 15_000;

let scriptLoad: Promise<TurnstileApi> | null = null;

function injectScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    const failed = () => {
      delete window.__lirkodTurnstileReady;
      document.getElementById(SCRIPT_ID)?.remove();
      reject(new Error("Turnstile script failed to load"));
    };

    // Registered before the tag is appended: like the Maps API, Turnstile calls
    // this global by name when it is ready to render, which is later than the
    // script element's own `load` event.
    window.__lirkodTurnstileReady = () => {
      delete window.__lirkodTurnstileReady;
      const api = window.turnstile;
      if (api) resolve(api);
      else reject(new Error("Turnstile reported ready without exposing its API"));
    };

    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("error", failed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.onerror = failed;
    // render=explicit so the widget appears where the form puts it and when the
    // form is ready, rather than Turnstile scanning the document and rendering
    // itself into whatever it finds.
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js" +
      "?render=explicit&onload=__lirkodTurnstileReady";
    document.head.appendChild(script);
  });
}

function withTimeout(work: Promise<TurnstileApi>): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Turnstile did not load within ${LOAD_TIMEOUT_MS}ms`));
    }, LOAD_TIMEOUT_MS);

    work.then(
      (api) => {
        clearTimeout(timer);
        resolve(api);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Memoised for the life of the page, and cleared on failure so a remount retries
 * rather than inheriting one bad network moment for ever.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);

  if (!scriptLoad) {
    scriptLoad = withTimeout(injectScript());
    scriptLoad.catch(() => {
      scriptLoad = null;
    });
  }

  return scriptLoad;
}
