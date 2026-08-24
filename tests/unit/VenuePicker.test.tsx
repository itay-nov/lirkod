// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenuePicker } from "@/components/VenuePicker";
import type { VenueOption } from "@/lib/db/venues";
import { he } from "@/lib/i18n/he";

const maps = vi.hoisted(() => ({
  startAutocompleteSession: vi.fn(),
  suggest: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/lib/maps/placesAutocomplete", () => maps);

vi.mock("@/app/(public)/profile/actions", () => ({ addVenueAction: vi.fn() }));

const RECENT: readonly VenueOption[] = [
  { id: "recent-1", name: "האולם האחרון", address: "רחוב ראשון" },
  { id: "recent-2", name: "האולם הקודם", address: "רחוב שני" },
  { id: "recent-3", name: "האולם השלישי", address: "רחוב שלישי" },
];

const INITIAL: readonly VenueOption[] = [
  RECENT[1]!,
  { id: "other", name: "אולם אחר", address: "רחוב רביעי" },
];

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ venues: INITIAL }) }),
  );
  maps.startAutocompleteSession.mockReset();
  maps.suggest.mockReset();
  maps.select.mockReset();
  maps.startAutocompleteSession.mockResolvedValue({
    suggest: maps.suggest.mockResolvedValue([]),
    select: maps.select,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("VenuePicker recent venues", () => {
  it("shows three own recent venues first, newest first, without duplicating the main list", () => {
    render(
      <VenuePicker
        initialVenues={INITIAL}
        recentVenues={RECENT}
        mapsApiKey="maps-key"
        venueId=""
        onVenueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: he.publishDance.recentVenuesHeading })).toBeVisible();
    const venueRadios = screen.getAllByRole("radio");
    expect(venueRadios.map((radio) => radio.getAttribute("value"))).toEqual([
      "recent-1",
      "recent-2",
      "recent-3",
      "other",
    ]);
  });

  it("hides the shortlist while typing and keeps the full server search active", async () => {
    render(
      <VenuePicker
        initialVenues={INITIAL}
        recentVenues={RECENT}
        mapsApiKey="maps-key"
        venueId=""
        onVenueChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(he.publishDance.venueSearchLabel), {
      target: { value: "חולון" },
    });

    expect(
      screen.queryByRole("heading", { name: he.publishDance.recentVenuesHeading }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        `/api/venues/search?q=${encodeURIComponent("חולון")}`,
      ),
    );
  });

  it("offers keyboard buttons before Places and selects one without a Places selection", async () => {
    const onVenueChange = vi.fn();
    render(
      <VenuePicker
        initialVenues={INITIAL}
        recentVenues={RECENT}
        mapsApiKey="maps-key"
        venueId=""
        onVenueChange={onVenueChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: he.publishDance.addVenueToggle }));
    const quickPick = await screen.findByRole("button", { name: /האולם האחרון/ });
    fireEvent.click(quickPick);

    expect(onVenueChange).toHaveBeenCalledWith("recent-1");
    expect(screen.getByLabelText(he.publishDance.venueSearchLabel)).toBeVisible();
    expect(maps.startAutocompleteSession).toHaveBeenCalledTimes(1);
    expect(maps.select).not.toHaveBeenCalled();
  });
});
