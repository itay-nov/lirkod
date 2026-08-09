import { describe, expect, it } from "vitest";
import { retryAfterSeconds, signInErrorKind } from "@/lib/domain/signInError";

describe("signInErrorKind", () => {
  it("collapses every 'you asked too soon' shape onto one message", () => {
    // These differ only in which limit tripped — the per-number cooldown, the
    // per-IP one, or the project's hourly SMS budget — and a dancer can act on
    // none of that distinction. See docs/decisions/0013.
    expect(signInErrorKind("over_sms_send_rate_limit")).toBe("tooSoon");
    expect(signInErrorKind("over_request_rate_limit")).toBe("tooSoon");
    expect(signInErrorKind("sms_send_failed")).toBe("tooSoon");
  });

  it("keeps a failed challenge separate — it is retryable, and differently", () => {
    expect(signInErrorKind("captcha_failed")).toBe("captcha");
  });

  it("does not pretend to tell a wrong code apart from an expired one", () => {
    // GoTrue answers both — and a code for a number that never asked — with
    // otp_expired / "Token has expired or is invalid" (verified against the local
    // stack). One kind, because inventing a third message would mean telling a
    // dancer who mistyped that their code expired.
    expect(signInErrorKind("otp_expired")).toBe("badCode");
    expect(signInErrorKind("invalid_credentials")).toBe("badCode");
  });

  it("falls back to 'unknown' rather than leaking a provider string", () => {
    expect(signInErrorKind(undefined)).toBe("unknown");
    expect(signInErrorKind("something_gotrue_added_last_tuesday")).toBe("unknown");
  });

  it("does not treat an inherited Object property as a known code", () => {
    // The lookup is a plain object literal, so "constructor" and "toString"
    // would otherwise resolve to something truthy and be returned as a kind.
    expect(signInErrorKind("constructor")).toBe("unknown");
    expect(signInErrorKind("toString")).toBe("unknown");
  });
});

describe("retryAfterSeconds", () => {
  it("reads the wait out of GoTrue's cooldown message", () => {
    expect(
      retryAfterSeconds("For security purposes, you can only request this after 47 seconds."),
    ).toBe(47);
  });

  it("handles the singular", () => {
    expect(
      retryAfterSeconds("For security purposes, you can only request this after 1 second."),
    ).toBe(1);
  });

  it("gives up quietly when the wording is not what it expects", () => {
    // Deliberate: this is the one place that parses English prose from GoTrue,
    // so an upstream rewording must cost us the number and nothing else — the
    // caller already has a message that works without it.
    expect(retryAfterSeconds("Please wait a while")).toBeNull();
    expect(retryAfterSeconds(undefined)).toBeNull();
    expect(retryAfterSeconds("")).toBeNull();
    expect(retryAfterSeconds("after 0 seconds")).toBeNull();
  });
});
