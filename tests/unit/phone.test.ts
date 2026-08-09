import { describe, expect, it } from "vitest";
import { formatIsraeliPhone, normalizeIsraeliPhone } from "@/lib/domain/phone";

const E164 = "+972501234567";

describe("normalizeIsraeliPhone", () => {
  it("accepts the plain local form", () => {
    expect(normalizeIsraeliPhone("0501234567")).toBe(E164);
  });

  it.each([
    ["050-123-4567", "hyphens, as printed on a business card"],
    ["050 123 4567", "spaces"],
    ["(050) 123-4567", "brackets"],
    ["050.123.4567", "dots"],
    ["  0501234567  ", "surrounding whitespace"],
  ])("strips %s (%s)", (input) => {
    expect(normalizeIsraeliPhone(input)).toBe(E164);
  });

  it.each([
    ["+972501234567", "already E.164"],
    ["+972-50-123-4567", "E.164 as a human writes it"],
    ["00972501234567", "the landline international prefix"],
    ["972501234567", "E.164 with the plus lost — GoTrue's own user.phone"],
    ["+9720501234567", "country code AND the trunk zero, which people do write"],
  ])("normalises %s (%s)", (input) => {
    expect(normalizeIsraeliPhone(input)).toBe(E164);
  });

  it("strips the invisible directional marks an RTL input adds to a paste", () => {
    // The regression this guards: a dancer pastes a number that looks correct,
    // and is told it is invalid, with nothing on screen to explain why.
    expect(normalizeIsraeliPhone("‪050-123-4567‬")).toBe(E164);
    expect(normalizeIsraeliPhone("‎0501234567")).toBe(E164);
  });

  it.each([
    ["", "empty"],
    ["   ", "whitespace only"],
    ["050123456", "one digit short"],
    ["05012345678", "one digit long"],
    ["031234567", "a Tel Aviv landline — cannot receive an SMS"],
    ["1800123456", "a service number"],
    ["+15551234567", "a US number"],
    ["+442071234567", "a UK number"],
    ["050-123-456a", "a letter in the middle"],
    ["not a phone", "prose"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizeIsraeliPhone(input)).toBeNull();
  });

  it("is idempotent — normalising its own output changes nothing", () => {
    const once = normalizeIsraeliPhone("050-123-4567");
    expect(once).not.toBeNull();
    expect(normalizeIsraeliPhone(once as string)).toBe(once);
  });
});

describe("formatIsraeliPhone", () => {
  it("turns stored E.164 into the shape an Israeli reads", () => {
    expect(formatIsraeliPhone(E164)).toBe("050-1234567");
  });

  it("accepts the plus-less form GoTrue returns in user.phone", () => {
    expect(formatIsraeliPhone("972500000004")).toBe("050-0000004");
  });

  it("returns anything it cannot parse untouched, rather than hiding it", () => {
    expect(formatIsraeliPhone("+15551234567")).toBe("+15551234567");
    expect(formatIsraeliPhone("")).toBe("");
  });
});
