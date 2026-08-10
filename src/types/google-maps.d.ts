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

  /**
   * The Places API (NEW) surface, which is a different set of classes from the
   * ones most examples still show.
   *
   * Verified against the configured key before any of this was written: the
   * legacy endpoints answer "You're calling a legacy API, which is not enabled
   * for your project", and only the new ones respond. So there is deliberately
   * no `AutocompleteService` or `PlacesService` declared here — those classes do
   * exist on `google.maps.places` at runtime, and leaving them undeclared is
   * what stops someone reaching for them and meeting REQUEST_DENIED in
   * production instead of in review.
   */
  namespace places {
    /**
     * Groups the keystrokes and the one details lookup that follows them into a
     * single billable unit. Opaque by design — it is only ever handed straight
     * back to Google.
     */
    class AutocompleteSessionToken {
      constructor();
    }

    interface AutocompleteRequest {
      input: string;
      /** ISO country codes. The new spelling of the legacy `componentRestrictions`. */
      includedRegionCodes?: string[];
      language?: string;
      region?: string;
      sessionToken?: AutocompleteSessionToken;
    }

    /** The rendered line, which Google also exposes split into emboldenable parts. */
    interface FormattableText {
      toString(): string;
    }

    interface PlacePrediction {
      placeId: string;
      text: FormattableText;
      /**
       * A `Place` Google has already tied to this autocomplete session.
       *
       * The reason it is declared, and the reason the code must use it: a
       * `fetchFields` on this object carries the session token, while the same
       * call on `new Place({ id })` does not — and Google then bills the details
       * lookup, and every keystroke that preceded it, as separate requests.
       */
      toPlace(): Place;
    }

    interface AutocompleteSuggestionResult {
      placePrediction: PlacePrediction | null;
    }

    class AutocompleteSuggestion {
      static fetchAutocompleteSuggestions(
        request: AutocompleteRequest,
      ): Promise<{ suggestions: AutocompleteSuggestionResult[] }>;
    }

    interface PlaceOptions {
      id: string;
      requestedLanguage?: string;
    }

    /** A point with accessor methods rather than plain numbers, as Maps returns it. */
    interface LatLng {
      lat(): number;
      lng(): number;
    }

    /**
     * Every field arrives null until `fetchFields` has asked for it by name — the
     * field mask is what Google prices a details call on, so the nullability here
     * is a billing decision showing through the type.
     */
    class Place {
      constructor(options: PlaceOptions);
      id: string | null;
      displayName: string | null;
      formattedAddress: string | null;
      location: LatLng | null;
      fetchFields(request: { fields: string[] }): Promise<{ place: Place }>;
    }
  }

  function importLibrary(name: "core"): Promise<{ LatLngBounds: typeof LatLngBounds }>;
  function importLibrary(name: "maps"): Promise<{ Map: typeof Map }>;
  function importLibrary(
    name: "marker",
  ): Promise<{ AdvancedMarkerElement: typeof marker.AdvancedMarkerElement }>;
  function importLibrary(name: "places"): Promise<{
    AutocompleteSessionToken: typeof places.AutocompleteSessionToken;
    AutocompleteSuggestion: typeof places.AutocompleteSuggestion;
    Place: typeof places.Place;
  }>;
}

interface Window {
  /**
   * The `callback` the API script invokes once it has finished bootstrapping.
   * Named rather than anonymous because the script tag can only reference a
   * global by name. Deleted as soon as it fires.
   */
  __lirkodGoogleMapsReady?: () => void;
}
