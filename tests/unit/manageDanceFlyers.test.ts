import { describe, expect, it } from "vitest";
import { toManageableDanceFlyers } from "@/lib/domain/manageDanceFlyers";

describe("toManageableDanceFlyers", () => {
  it("includes the next date and time and numbers exact duplicate labels", () => {
    const dances = toManageableDanceFlyers([
      {
        eventId: "first",
        venueName: "אותו אולם",
        nextStartsAt: "2026-08-31T17:00:00.000Z",
        flyerUrl: null,
      },
      {
        eventId: "second",
        venueName: "אותו אולם",
        nextStartsAt: "2026-08-31T17:00:00.000Z",
        flyerUrl: null,
      },
      {
        eventId: "third",
        venueName: "אותו אולם",
        nextStartsAt: "2026-09-01T18:00:00.000Z",
        flyerUrl: null,
      },
    ]);

    expect(dances[0]?.danceLabel).toMatch(/אותו אולם.*הרקדה 1/);
    expect(dances[1]?.danceLabel).toMatch(/אותו אולם.*הרקדה 2/);
    expect(dances[2]?.danceLabel).toMatch(/אותו אולם.*יום.*21:00/);
  });
});
