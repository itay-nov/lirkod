"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addVenueAction } from "@/app/(public)/profile/actions";
import type { VenueOption } from "@/lib/db/venues";
import {
  startAutocompleteSession,
  type AutocompleteSession,
  type PlaceSuggestion,
} from "@/lib/maps/placesAutocomplete";
import { GoogleAttribution } from "./GoogleAttribution";
import { FIELD_CLASS, HINT_CLASS, LABEL_CLASS } from "./formStyles";
import { he } from "@/lib/i18n/he";

/**
 * Choosing where a dance happens: search the halls we know, or add one from
 * Google Places if it is missing.
 *
 * Two things about the shape, both deliberate.
 *
 * The search is SERVER-side now. 3.2a filtered the whole table in the browser,
 * which was correct while `venues` held three curated rows and stopped being
 * correct the moment 3.2b let anyone add one — the browser would have to hold
 * every hall in the country to filter it. Each search is a bounded query
 * (`/api/venues/search`), debounced so typing does not mean a request per key.
 *
 * Neither list is a combobox. Results are radio buttons and Google's suggestions
 * are ordinary buttons, so everything is reachable with Tab and the arrow keys
 * using native semantics — no `aria-expanded`, no listbox to get subtly wrong,
 * and nothing that works only with a pointer (AGENTS.md §2.7). For a 50+
 * audience a visible list beats a dropdown that appears and vanishes.
 */

/**
 * Long enough that a normal typist sends one request per word rather than per
 * letter, short enough that the list feels attached to the keyboard.
 */
const SEARCH_DEBOUNCE_MS = 250;

const OPTION_CLASS =
  "flex min-h-12 items-start gap-3 rounded-lg border-2 border-muted/50 px-3 py-2 " +
  "has-[:checked]:border-secondary has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-secondary";

const SUGGESTION_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-muted/50 px-3 py-2 text-start " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary";

const TOGGLE_CLASS =
  "min-h-12 w-full rounded-lg border-2 border-secondary px-4 py-3 text-secondary " +
  "focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary " +
  "disabled:opacity-70";

export function VenuePicker({
  initialVenues,
  mapsApiKey,
  venueId,
  onVenueChange,
}: {
  /** Rendered by the server so the list is populated before any JS runs. */
  initialVenues: readonly VenueOption[];
  /** Null when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is unset; adding a venue is then off. */
  mapsApiKey: string | null;
  venueId: string;
  onVenueChange: (venueId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [venues, setVenues] = useState<readonly VenueOption[]>(initialVenues);
  const [searching, setSearching] = useState(false);

  const [adding, setAdding] = useState(false);
  const [placeQuery, setPlaceQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [savingVenue, setSavingVenue] = useState(false);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const sessionRef = useRef<AutocompleteSession | null>(null);
  /**
   * Mirrors `sessionRef` into render state, which a ref alone cannot do.
   *
   * Without it there is a race a fast typist hits every time: opening the panel
   * starts an async script load, and anything typed before it resolves runs the
   * suggestion effect while the ref is still null. The effect returns, and since
   * a ref assignment triggers no re-render, nothing ever asks again — the field
   * sits there accepting text and never suggesting anything. Caught by
   * tests/e2e/addVenue.spec.ts on the second open, when the cached script made
   * the ordering flip.
   */
  const [sessionReady, setSessionReady] = useState(false);
  const placeInputRef = useRef<HTMLInputElement>(null);

  /**
   * Guards against an out-of-order response overwriting a newer one. Typing
   * "בית" fires three searches and the network is under no obligation to answer
   * them in order; without this the list can settle on the results for "בי".
   */
  const searchRun = useRef(0);

  useEffect(() => {
    const run = ++searchRun.current;

    // `setSearching` belongs inside the timer, not beside it. Setting it in the
    // effect body would flash "מחפשים…" for every keystroke that the debounce
    // then throws away — and React rightly objects to a synchronous setState in
    // an effect, because it cascades a render per key.
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        try {
          const response = await fetch(`/api/venues/search?q=${encodeURIComponent(query)}`);
          if (!response.ok) return;
          const body: unknown = await response.json();
          const found = (body as { venues?: VenueOption[] }).venues ?? [];
          if (run === searchRun.current) setVenues(found);
        } catch {
          // Not swallowed (AGENTS.md §6): a failed search has one sensible
          // outcome for a dancer — the list they can already see stays as it is.
          // Replacing it with an error would take away the halls they could
          // otherwise still pick from.
        } finally {
          if (run === searchRun.current) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const openAddVenue = useCallback(async () => {
    setAddError(null);
    setAdding(true);
    setSuggestions([]);
    setPlaceQuery("");
    setSessionReady(false);

    if (mapsApiKey === null) {
      setAddError(he.publishDance.addVenueErrors.unavailable);
      return;
    }

    try {
      sessionRef.current = await startAutocompleteSession(mapsApiKey);
      setSessionReady(true);
      placeInputRef.current?.focus();
    } catch {
      setAddError(he.publishDance.addVenueErrors.unavailable);
    }
  }, [mapsApiKey]);

  /**
   * Derived rather than stored. Clearing a `suggestions` state in an effect
   * whenever the query got too short was a synchronous setState-in-effect — a
   * cascading render, and a second source of truth for something the query
   * already answers.
   */
  const showSuggestions = adding && placeQuery.trim().length >= 2;

  useEffect(() => {
    if (!showSuggestions || !sessionReady) return;

    const session = sessionRef.current;
    if (!session) return;

    const timer = setTimeout(() => {
      void session
        .suggest(placeQuery)
        .then(setSuggestions)
        .catch(() => setAddError(he.publishDance.addVenueErrors.unavailable));
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [showSuggestions, sessionReady, placeQuery]);

  async function choosePlace(placeId: string): Promise<void> {
    const session = sessionRef.current;
    if (!session) return;

    setAddError(null);
    setSavingVenue(true);
    try {
      const place = await session.select(placeId);
      // The session token is spent by `select`, so the next search needs a fresh
      // session or Google starts billing per keystroke.
      sessionRef.current = null;
      setSessionReady(false);

      if (place === null) {
        setAddError(he.publishDance.addVenueErrors.failed);
        return;
      }

      const result = await addVenueAction(place);
      if (!result.ok) {
        setAddError(he.publishDance.addVenueErrors.failed);
        return;
      }

      // Straight into the list AND selected: the instructor added this hall in
      // order to use it, so making them find it again would be a step for
      // nothing (AGENTS.md §2).
      setVenues((current) =>
        current.some((venue) => venue.id === result.venue.id)
          ? current
          : [result.venue, ...current],
      );
      onVenueChange(result.venue.id);
      setAddedName(result.venue.name);
      setAdding(false);
      setSuggestions([]);
      setPlaceQuery("");
    } catch {
      setAddError(he.publishDance.addVenueErrors.failed);
    } finally {
      setSavingVenue(false);
    }
  }

  return (
    <fieldset>
      <legend className={LABEL_CLASS}>{he.publishDance.venueLabel}</legend>

      {adding ? (
        <div className="pt-2">
          <h3 className="font-bold">{he.publishDance.addVenueHeading}</h3>
          <p className={HINT_CLASS}>{he.publishDance.addVenueIntro}</p>

          <label htmlFor="place-search" className="block pb-2 pt-4">
            {he.publishDance.addVenueSearchLabel}
          </label>
          <input
            id="place-search"
            ref={placeInputRef}
            type="search"
            value={placeQuery}
            onChange={(event) => setPlaceQuery(event.target.value)}
            placeholder={he.publishDance.addVenueSearchPlaceholder}
            disabled={savingVenue}
            className={FIELD_CLASS}
          />

          {savingVenue ? (
            <p aria-live="polite" className="pt-3">
              {he.publishDance.addVenueSaving}
            </p>
          ) : null}

          {showSuggestions && suggestions.length > 0 ? (
            <ul
              aria-label={he.publishDance.addVenueSuggestionsLabel}
              className="flex flex-col gap-2 pt-3"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.placeId}>
                  <button
                    type="button"
                    onClick={() => void choosePlace(suggestion.placeId)}
                    disabled={savingVenue}
                    className={SUGGESTION_CLASS}
                  >
                    {suggestion.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {showSuggestions && suggestions.length === 0 && !savingVenue ? (
            <p className="pt-3">{he.publishDance.addVenueEmpty}</p>
          ) : null}

          {/*
            Google's Places policy requires this wherever predictions appear
            without a Google map, which is our case — /profile has no map. Shown
            whenever the Places field is open rather than only alongside results,
            so it is present while Google is being queried too.
          */}
          <GoogleAttribution />

          <div className="pt-4">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setAddError(null);
                sessionRef.current = null;
                setSessionReady(false);
              }}
              className={TOGGLE_CLASS}
            >
              {he.publishDance.addVenueCancel}
            </button>
          </div>
        </div>
      ) : (
        <>
          <label htmlFor="venue-search" className="block pb-2">
            {he.publishDance.venueSearchLabel}
          </label>
          <input
            id="venue-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={he.publishDance.venueSearchPlaceholder}
            className={FIELD_CLASS}
          />

          {/*
            One live region for the result count rather than announcing the list
            itself: a screen reader user typing gets "נמצאו 3 מקומות" instead of
            the whole list read out again on every keystroke.
          */}
          <p aria-live="polite" className="pt-2 text-secondary">
            {searching
              ? he.publishDance.venueSearching
              : he.publishDance.venueResultCount(venues.length)}
          </p>

          {venues.length === 0 ? (
            <p className="pt-1">{he.publishDance.venueEmpty}</p>
          ) : (
            <div className="flex flex-col gap-2 pt-1">
              {venues.map((venue) => (
                <label key={venue.id} className={OPTION_CLASS}>
                  <input
                    type="radio"
                    name="venueId"
                    value={venue.id}
                    checked={venueId === venue.id}
                    onChange={() => onVenueChange(venue.id)}
                    className="mt-1 size-6 shrink-0 accent-[var(--color-secondary)]"
                  />
                  <span>
                    <span className="block font-bold">{venue.name}</span>
                    <span className="block text-secondary">{venue.address}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="pt-4">
            <button
              type="button"
              onClick={() => void openAddVenue()}
              className={TOGGLE_CLASS}
            >
              {he.publishDance.addVenueToggle}
            </button>
          </div>
        </>
      )}

      <p id="venue-error" role="alert" aria-live="assertive" className="pt-3 font-bold text-accent">
        {addError}
      </p>
      <p aria-live="polite" className="pt-1 font-bold">
        {addedName === null ? "" : he.publishDance.addVenueAdded(addedName)}
      </p>
    </fieldset>
  );
}
