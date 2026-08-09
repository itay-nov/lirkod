/**
 * A hand-written slice of the Google Maps JavaScript API — only the members
 * this app actually touches.
 *
 * Written out rather than pulled in as `@types/google.maps` on purpose. The
 * dependency would be dev-only and harmless, but AGENTS.md §13 asks for the
 * smallest thing that solves the problem, and what we need from a 30,000-line
 * ambient declaration is the two dozen members below. Declaring them here has a
 * second effect worth more than the convenience: reaching for an API that is
 * not in this file fails to compile, so the surface we depend on cannot grow
 * silently — it has to be added here, deliberately, with the rest of the code
 * review. If that surface ever gets big enough that maintaining it is real
 * work, swapping to the DefinitelyTyped package is a one-line change and this
 * comment is the reason to make it.
 *
 * Ambient and global, matching how the script tag publishes the API: there is
 * no module to import from, `google` simply exists once the script has run.
 */

declare namespace google.maps {
  interface LatLngLiteral {
    lat: number;
    lng: number;
  }

  interface Padding {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }

  interface MapOptions {
    center?: LatLngLiteral;
    zoom?: number;
    /**
     * Required for advanced markers. Without one the marker library refuses to
     * render — see the note in `loadGoogleMaps.ts`.
     */
    mapId?: string;
    disableDefaultUI?: boolean;
    zoomControl?: boolean;
    mapTypeControl?: boolean;
    streetViewControl?: boolean;
    fullscreenControl?: boolean;
    rotateControl?: boolean;
    scaleControl?: boolean;
    /** Google's own points of interest. Turned off so only our pins are clickable. */
    clickableIcons?: boolean;
    gestureHandling?: "cooperative" | "greedy" | "none" | "auto";
    keyboardShortcuts?: boolean;
  }

  class LatLngBounds {
    constructor();
    extend(point: LatLngLiteral): LatLngBounds;
    isEmpty(): boolean;
  }

  class Map {
    constructor(element: HTMLElement, options?: MapOptions);
    fitBounds(bounds: LatLngBounds, padding?: number | Padding): void;
    panTo(latLng: LatLngLiteral): void;
    setCenter(latLng: LatLngLiteral): void;
    setZoom(zoom: number): void;
  }

  namespace marker {
    interface AdvancedMarkerElementOptions {
      map?: Map | null;
      position?: LatLngLiteral;
      content?: HTMLElement;
      title?: string;
      zIndex?: number;
      /**
       * Makes the marker clickable AND focusable: Google puts it in the tab
       * order with `role="button"`, and Enter/Space raise the same "click" the
       * mouse does. This one flag is what makes a keyboard user able to open a
       * pin's preview at all.
       */
      gmpClickable?: boolean;
    }

    /**
     * A real custom element, so it is an HTMLElement — which is both how the
     * preview panel hands focus back to the pin it came from, and why the pin's
     * activation is an ordinary `addEventListener`. The event to listen for is
     * `gmp-click`, not `click`: the library warns that `click` is the legacy
     * path, and `gmp-click` is the one it raises for a keyboard Enter/Space on
     * a focused marker as well as for a pointer. Getting this wrong is the
     * difference between a map anyone can use and a mouse-only one.
     */
    class AdvancedMarkerElement extends HTMLElement {
      constructor(options?: AdvancedMarkerElementOptions);
      map: Map | null;
      position: LatLngLiteral | null;
      content: HTMLElement | null;
      title: string;
      zIndex: number | null;
      gmpClickable: boolean;
    }
  }

  function importLibrary(name: "core"): Promise<{ LatLngBounds: typeof LatLngBounds }>;
  function importLibrary(name: "maps"): Promise<{ Map: typeof Map }>;
  function importLibrary(
    name: "marker",
  ): Promise<{ AdvancedMarkerElement: typeof marker.AdvancedMarkerElement }>;
}

interface Window {
  /**
   * The `callback` the API script invokes once it has finished bootstrapping.
   * Named rather than anonymous because the script tag can only reference a
   * global by name. Deleted as soon as it fires.
   */
  __lirkodGoogleMapsReady?: () => void;
}
