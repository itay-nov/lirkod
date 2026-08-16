"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleFavorite, useFavorites } from "@/lib/favorites/favoritesStore";
import { he } from "@/lib/i18n/he";

/**
 * The heart toggle — on the map's preview panel, the schedule row, and the
 * favorites list on /profile (Phase 4.5). One component for all three so a
 * filled heart means the same thing, drawn the same way, everywhere it
 * appears.
 *
 * Three states, not two: unfavorited, favorited, and — for a guest — "shows a
 * sign-in prompt instead of acting" (AGENTS.md §2.2: a guest is not missing a
 * permission, so tapping the heart must never read as an error). The prompt
 * reuses `he.favorites.signedOutEmpty` rather than its own string, so a guest
 * meets the same sentence here as in the empty /profile section.
 *
 * `eventId` is the SERIES, not the occurrence a pin or row happens to be
 * showing right now (docs/decisions/0002) — favoriting has to keep meaning
 * "this recurring dance" as new nights are generated ahead of it.
 *
 * `variant` (Phase 4.6c) picks between two renderings of the SAME control —
 * the round icon used on `DanceRow` and the /profile favorites list, and a
 * wide filled pill for the map preview panel's restyled action cluster. Every
 * other line in this file (state, the click handler, the sign-in prompt, the
 * error message, both `aria-*` attributes) is shared: only the two `return`
 * branches differ, so a filled heart still means the same thing everywhere it
 * appears, exactly as the paragraph above already promises.
 */
export function FavoriteButton({
  eventId,
  venueName,
  variant = "icon",
}: {
  eventId: string;
  venueName: string;
  variant?: "icon" | "pill";
}) {
  const router = useRouter();
  const { loaded, signedIn, favoriteEventIds, pendingEventIds } = useFavorites();
  const [showSignInPrompt, setShowSignInPrompt] = useState(false);
  const [error, setError] = useState(false);

  const favorited = favoriteEventIds.has(eventId);
  const pending = pendingEventIds.has(eventId);

  function handleClick(): void {
    if (!signedIn) {
      setShowSignInPrompt(true);
      return;
    }

    setShowSignInPrompt(false);
    setError(false);
    void toggleFavorite(eventId).then((succeeded) => {
      if (!succeeded) {
        setError(true);
        return;
      }
      // The action already called revalidatePath("/profile") server-side;
      // this is what makes an un-favorited row actually leave the "My
      // Favorites" list in place, rather than sitting there — unfilled and
      // stale — until the next full navigation. Harmless on the map and
      // schedule, whose own server-rendered content never depended on
      // favorites in the first place.
      router.refresh();
    });
  }

  const ariaLabel = favorited ? he.favorites.remove(venueName) : he.favorites.add(venueName);
  const heart = (filled: boolean, className: string) => (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20.5s-7-4.6-9.4-8.8C1 8.7 2 5.5 5.2 5.5c2 0 3.4 1.1 4.1 2.3.7-1.2 2.1-2.3 4.1-2.3 3.2 0 4.2 3.2 2.6 6.2-2.4 4.2-9.4 8.8-9.4 8.8z" />
    </svg>
  );

  // assertive: a live region that only ever appears to report a problem the
  // dancer's tap just caused, so it should interrupt the same way
  // NightControls' error message does.
  const messageText = showSignInPrompt
    ? he.favorites.signedOutEmpty
    : error
      ? he.favorites.errors.failed
      : null;

  if (variant === "pill") {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={handleClick}
          disabled={!loaded || pending}
          aria-pressed={favorited}
          aria-label={ariaLabel}
          // Always filled pomegranate regardless of state (the task's "wide
          // filled pomegranate pill") — the heart's own fill and the visible
          // text are what change, so state is never colour alone (AGENTS.md
          // §2.6) even though the pill's background never does.
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-3 font-bold text-surface transition-transform duration-150 ease-out active:scale-[0.98] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-70"
        >
          {heart(favorited, "size-6 shrink-0")}
          {favorited ? he.favorites.removeShort : he.favorites.saveShort}
        </button>
        {messageText !== null && (
          <p role="status" aria-live="assertive" className="text-secondary">
            {messageText}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        // Disabled until the first `getOwnFavoritesAction` answer lands, not
        // hidden: an impatient tap in that brief window would otherwise read
        // `signedIn` as still false and wrongly show the guest prompt to
        // someone who is in fact signed in. The window is one same-origin
        // round trip, not a third-party script load, so this is momentary in
        // the way `SignOutButton`'s own disabled-while-busy state is.
        disabled={!loaded || pending}
        aria-pressed={favorited}
        aria-label={ariaLabel}
        className={`flex size-12 shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out active:scale-90 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-70 ${
          favorited ? "text-accent" : "text-secondary"
        }`}
      >
        {heart(favorited, "size-7")}
      </button>

      {messageText !== null && (
        <p role="status" aria-live="assertive" className="max-w-40 text-end text-secondary">
          {messageText}
        </p>
      )}
    </div>
  );
}
