import { describe, expect, it } from "vitest";
import { whatsAppShareUrl } from "@/lib/maps/shareLinks";

describe("whatsAppShareUrl", () => {
  it("opens the contact picker with the text pre-filled", () => {
    const url = whatsAppShareUrl("hello");

    expect(url).toBe("https://wa.me/?text=hello");
  });

  it("keeps newlines intact instead of losing them to a raw query string", () => {
    const url = whatsAppShareUrl("line one\nline two");

    expect(url).toBe("https://wa.me/?text=line%20one%0Aline%20two");
    // decodeURIComponent is the browser's own inverse of what this builds, so
    // round-tripping it is the strongest possible assertion that nothing was
    // lost or garbled on the way in.
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(
      "line one\nline two",
    );
  });

  it("carries Hebrew text through unescaped-looking but correctly encoded", () => {
    const url = whatsAppShareUrl("הרקדה עם רונית");

    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe(
      "הרקדה עם רונית",
    );
  });

  it("encodes characters that would otherwise be read as extra query parameters", () => {
    const url = whatsAppShareUrl("a&b=c");

    expect(url).not.toContain("&b=c");
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe("a&b=c");
  });
});
