// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The loader's failure handling, which matters more here than it would in most
 * apps: AGENTS.md §2.9 assumes a mid-range Android on 4G, so a several-hundred
 * kilobyte third-party script taking longer than the 15s wait is an ordinary
 * Tuesday, not an edge case.
 *
 * The regression under test: giving up on a slow load used to leave the script
 * tag and its pending callback in the document while clearing the memo, so the
 * next attempt found a stale tag and rejected instantly — for the life of the
 * page, even though the original download would have finished a second later.
 *
 * Module state is per-import by design (one script tag per page), so every test
 * takes a fresh copy through `vi.resetModules()`.
 */

const SCRIPT_ID = "google-maps-js-api";
const TIMEOUT_MS = 15_000;

interface Loader {
  loadGoogleMaps: (apiKey: string) => Promise<unknown>;
}

async function freshLoader(): Promise<Loader> {
  vi.resetModules();
  return (await import("@/lib/maps/loadGoogleMaps")) as Loader;
}

function scriptTag(): HTMLElement | null {
  return document.getElementById(SCRIPT_ID);
}

/** Stands in for the API having finished bootstrapping. */
function installGoogle(): void {
  vi.stubGlobal("google", {
    maps: {
      importLibrary: (name: string) =>
        Promise.resolve(
          name === "core"
            ? { LatLngBounds: class {} }
            : name === "maps"
              ? { Map: class {} }
              : { AdvancedMarkerElement: class {} },
        ),
    },
  });
}

/** What the Maps script does once it has initialised: call our named callback. */
function fireReadyCallback(): void {
  const ready = (window as Window).__lirkodGoogleMapsReady;
  expect(ready, "the ready callback should still be registered").toBeTypeOf("function");
  ready?.();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = "";
  delete window.__lirkodGoogleMapsReady;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadGoogleMaps", () => {
  it("injects one script tag and resolves when the API reports ready", async () => {
    const { loadGoogleMaps } = await freshLoader();

    const loading = loadGoogleMaps("test-key");
    expect(scriptTag()).not.toBeNull();

    installGoogle();
    fireReadyCallback();

    await expect(loading).resolves.toMatchObject({
      Map: expect.any(Function),
      AdvancedMarkerElement: expect.any(Function),
      LatLngBounds: expect.any(Function),
    });
  });

  it("gives up after the timeout so the UI can say the map is unavailable", async () => {
    const { loadGoogleMaps } = await freshLoader();

    const loading = loadGoogleMaps("test-key");
    const settled = expect(loading).rejects.toThrow(/did not load/);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);

    await settled;
  });

  it("leaves the in-flight download alone when a caller gives up", async () => {
    // The heart of the fix. Removing the tag here would throw away a download
    // that is nearly finished, on the exact connection least able to repeat it.
    const { loadGoogleMaps } = await freshLoader();

    const loading = loadGoogleMaps("test-key");
    const settled = expect(loading).rejects.toThrow(/did not load/);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await settled;

    expect(scriptTag()).not.toBeNull();
    expect(window.__lirkodGoogleMapsReady).toBeTypeOf("function");
  });

  it("lets a retry after a timeout actually succeed", async () => {
    // Previously this rejected instantly and for ever: the retry found the
    // stale tag and bailed before waiting for anything.
    const { loadGoogleMaps } = await freshLoader();

    const first = loadGoogleMaps("test-key");
    const firstSettled = expect(first).rejects.toThrow(/did not load/);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await firstSettled;

    // The slow download finishes a moment after the caller stopped waiting.
    installGoogle();
    fireReadyCallback();

    await expect(loadGoogleMaps("test-key")).resolves.toMatchObject({
      Map: expect.any(Function),
    });
    // Still one tag: the retry adopted the original rather than re-downloading.
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
  });

  it("lets a retry succeed even while the first load is still in flight", async () => {
    // A dancer who tabs away and back before the script lands. The second
    // attempt must attach to the same download, not start a second one.
    const { loadGoogleMaps } = await freshLoader();

    const first = loadGoogleMaps("test-key");
    const firstSettled = expect(first).rejects.toThrow(/did not load/);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    await firstSettled;

    const second = loadGoogleMaps("test-key");
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);

    installGoogle();
    fireReadyCallback();

    await expect(second).resolves.toMatchObject({ Map: expect.any(Function) });
  });

  it("clears the tag on a hard failure so the next attempt starts fresh", async () => {
    // A blocked host or a dead network is not a slow load: there is nothing in
    // flight worth adopting, so the tag has to go or the retry adopts a corpse.
    const { loadGoogleMaps } = await freshLoader();

    const loading = loadGoogleMaps("test-key");
    const settled = expect(loading).rejects.toThrow(/failed to load/);
    scriptTag()?.dispatchEvent(new Event("error"));
    await settled;

    expect(scriptTag()).toBeNull();
    expect(window.__lirkodGoogleMapsReady).toBeUndefined();

    // And the retry injects a genuinely new tag rather than giving up.
    void loadGoogleMaps("test-key").catch(() => undefined);
    expect(scriptTag()).not.toBeNull();
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const { loadGoogleMaps } = await freshLoader();

    const a = loadGoogleMaps("test-key");
    const b = loadGoogleMaps("test-key");

    expect(a).toBe(b);
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);

    installGoogle();
    fireReadyCallback();
    await expect(a).resolves.toBeDefined();
  });
});
