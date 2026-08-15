// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoriteButton } from "@/components/FavoriteButton";
import { resetFavoritesStoreForTests } from "@/lib/favorites/favoritesStore";
import { he } from "@/lib/i18n/he";

/**
 * `useRouter` is real only inside a Next.js request, never in a bare RTL
 * render, and `favoritesActions.ts` reaches for `cookies()` the same way —
 * both are replaced with test doubles this file controls directly, per test.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const actions = vi.hoisted(() => ({
  getOwnFavoritesAction: vi.fn(),
  addFavoriteAction: vi.fn(),
  removeFavoriteAction: vi.fn(),
}));
vi.mock("@/app/(public)/profile/favoritesActions", () => actions);

const VENUE = "היכל התרבות חולון";
const EVENT_ID = "c0000000-0000-0000-0000-000000000001";

afterEach(cleanup);

beforeEach(() => {
  // The store is a module-level singleton by design (see its own header) —
  // it has to start clean, or a favorite from one test leaks into the next.
  resetFavoritesStoreForTests();
  refresh.mockClear();
  actions.getOwnFavoritesAction.mockReset();
  actions.addFavoriteAction.mockReset();
  actions.removeFavoriteAction.mockReset();
});

describe("FavoriteButton", () => {
  it("starts disabled and unfilled, before the first lookup answers", () => {
    actions.getOwnFavoritesAction.mockReturnValue(new Promise(() => {}));
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("fills in once the lookup says this dance is already favorited", async () => {
    actions.getOwnFavoritesAction.mockResolvedValue({
      signedIn: true,
      favoriteEventIds: [EVENT_ID],
    });
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    await waitFor(() => expect(screen.getByRole("button")).not.toBeDisabled());
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName(he.favorites.remove(VENUE));
  });

  it("shows the sign-in prompt for a guest, and never calls the write action (AGENTS.md §2.2)", async () => {
    actions.getOwnFavoritesAction.mockResolvedValue({ signedIn: false, favoriteEventIds: [] });
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    const button = await screen.findByRole("button", { name: he.favorites.add(VENUE) });
    await waitFor(() => expect(button).not.toBeDisabled());

    button.click();

    expect(await screen.findByText(he.favorites.signedOutEmpty)).toBeInTheDocument();
    expect(actions.addFavoriteAction).not.toHaveBeenCalled();
    // A guest's tap is never treated as a failed write — no error message,
    // no aria-pressed flip, only the invitation to sign in.
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("favorites optimistically for a signed-in dancer, and calls the server action", async () => {
    actions.getOwnFavoritesAction.mockResolvedValue({ signedIn: true, favoriteEventIds: [] });
    actions.addFavoriteAction.mockResolvedValue({ ok: true });
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    const button = await screen.findByRole("button", { name: he.favorites.add(VENUE) });
    await waitFor(() => expect(button).not.toBeDisabled());

    button.click();

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(actions.addFavoriteAction).toHaveBeenCalledWith(EVENT_ID);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("un-favorites a dance that was already favorited", async () => {
    actions.getOwnFavoritesAction.mockResolvedValue({
      signedIn: true,
      favoriteEventIds: [EVENT_ID],
    });
    actions.removeFavoriteAction.mockResolvedValue({ ok: true });
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    const button = await screen.findByRole("button", { name: he.favorites.remove(VENUE) });
    await waitFor(() => expect(button).not.toBeDisabled());

    button.click();

    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    expect(actions.removeFavoriteAction).toHaveBeenCalledWith(EVENT_ID);
  });

  it("reverts the optimistic flip and reports the failure, rather than leaving it unexplained (AGENTS.md §6)", async () => {
    actions.getOwnFavoritesAction.mockResolvedValue({ signedIn: true, favoriteEventIds: [] });
    actions.addFavoriteAction.mockResolvedValue({ ok: false, reason: "failed" });
    render(<FavoriteButton eventId={EVENT_ID} venueName={VENUE} />);

    const button = await screen.findByRole("button", { name: he.favorites.add(VENUE) });
    await waitFor(() => expect(button).not.toBeDisabled());

    button.click();

    // Optimistic flip happens immediately…
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    // …then reverts once the action reports failure.
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    expect(await screen.findByText(he.favorites.errors.failed)).toBeInTheDocument();
  });
});
