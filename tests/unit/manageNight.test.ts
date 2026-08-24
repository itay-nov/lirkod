import { describe, expect, it } from "vitest";
import type { OwnNight } from "@/lib/db/nights";
import { toManageableNight } from "@/lib/domain/manageNight";
import { he } from "@/lib/i18n/he";

/**
 * The view model behind the manage list.
 *
 * Runs in the default "node" environment (no jsdom docblock), which is the
 * point: this is what keeps `Intl`, the `he` dictionary and the status table out
 * of the client bundle the controls ship in (AGENTS.md §2.9, §3).
 */

// 20:30–23:30 on a Monday in Asia/Jerusalem. Evening timestamps on purpose: a
// midday one would pass whether the conversion used Israel time or UTC.
const STARTS_AT = "2025-06-02T17:30:00.000Z";
const ENDS_AT = "2025-06-02T20:30:00.000Z";

function night(overrides: Partial<OwnNight> = {}): OwnNight {
  return {
    id: "d0000000-0000-0000-0000-000000000001",
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    status: "scheduled",
    cancellationReason: null,
    originalStartsAt: null,
    dateKey: "2025-06-02",
    venueId: "b0000000-0000-0000-0000-000000000001",
    venueName: "היכל התרבות חולון",
    venueAddress: "ויצמן 24, חולון",
    ...overrides,
  };
}

describe("toManageableNight", () => {
  it("renders the hours in Asia/Jerusalem, not UTC (AGENTS.md §7)", () => {
    const view = toManageableNight(night());

    expect(view.time).toBe("20:30");
    expect(view.startTimeField).toBe("20:30");
    expect(view.endTimeField).toBe("23:30");
  });

  it("fills the time fields in the exact shape a native time input accepts", () => {
    // "20:30", ASCII digits, zero-padded. A localised string with an RTL mark in
    // it would leave the field empty and the instructor with a control that
    // silently does nothing.
    const view = toManageableNight(night());

    expect(view.startTimeField).toMatch(/^\d{2}:\d{2}$/);
    expect(view.endTimeField).toMatch(/^\d{2}:\d{2}$/);
  });

  it("names which night a control acts on", () => {
    // Twelve buttons all called "שינוי" are twelve identical announcements to a
    // screen reader, and an unrecoverable mis-tap for everybody else.
    const view = toManageableNight(night());

    expect(view.whenText).toContain("20:30");
    expect(view.whenText).toContain("יום שני");
  });

  it("gives an ordinary night no status word", () => {
    expect(toManageableNight(night()).statusLabel).toBeNull();
  });

  it("shows an instructor the same words a dancer sees", () => {
    // The manage list and the schedule resolve their labels through the same
    // `appearanceFor`, so an instructor cannot be looking at a night described
    // one way while every dancer reads another.
    expect(toManageableNight(night({ status: "cancelled" })).statusLabel).toBe(
      he.dance.status.cancelled,
    );
    expect(toManageableNight(night({ status: "moved" })).statusLabel).toBe(
      he.dance.status.moved,
    );
    expect(
      toManageableNight(night({ originalStartsAt: "2025-06-02T16:30:00.000Z" })).statusLabel,
    ).toBe(he.dance.status.retimedFrom("19:30"));
  });

  it("shows the instructor the reason their dancers are being given", () => {
    const view = toManageableNight(
      night({ status: "cancelled", cancellationReason: "תקלה במזגן" }),
    );

    expect(view.cancelled).toBe(true);
    expect(view.cancellationText).toBe(he.manageNights.cancelledOn("תקלה במזגן"));
  });

  it("still says a night is off when no reason was given", () => {
    // The reason is optional, and a cancelled night with a blank line under it
    // would read as an unfinished screen to this audience.
    const view = toManageableNight(night({ status: "cancelled" }));

    expect(view.cancellationText).toBe(he.manageNights.cancelledNoReason);
  });

  it("marks a live night as not cancelled, so the cancel control is offered", () => {
    expect(toManageableNight(night()).cancelled).toBe(false);
    expect(toManageableNight(night()).cancellationText).toBeNull();
  });

  it("takes the venue name straight from the night, override included", () => {
    // The coalesce already happened in the query layer (docs/decisions/0003:
    // override_venue_id is authoritative for WHERE); this must not second-guess
    // it from the status.
    expect(toManageableNight(night({ venueName: "בית ציוני אמריקה" })).venueName).toBe(
      "בית ציוני אמריקה",
    );
  });

  it("carries the effective venue id and address into the edit picker", () => {
    const view = toManageableNight(
      night({
        venueId: "b0000000-0000-0000-0000-000000000002",
        venueName: "בית ציוני אמריקה",
        venueAddress: "שדרות שאול המלך 26, תל אביב",
      }),
    );

    expect(view.venueId).toBe("b0000000-0000-0000-0000-000000000002");
    expect(view.venueAddress).toBe("שדרות שאול המלך 26, תל אביב");
  });
});
