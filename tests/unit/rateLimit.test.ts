import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/domain/rateLimit";

/**
 * The clock is injected, so none of this waits on a timer — a rate limiter
 * tested with real delays is a slow suite that still only covers one window.
 */

function limiterAt(clock: { now: number }, limit = 3, windowMs = 60_000) {
  return createRateLimiter({ limit, windowMs, now: () => clock.now });
}

describe("createRateLimiter", () => {
  it("allows up to the limit and refuses the next one", () => {
    const clock = { now: 1_000 };
    const limiter = limiterAt(clock);

    for (let i = 0; i < 3; i++) {
      expect(limiter.check("a").allowed, `hit ${i + 1}`).toBe(true);
    }
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("counts each caller separately", () => {
    const clock = { now: 1_000 };
    const limiter = limiterAt(clock);

    for (let i = 0; i < 3; i++) limiter.check("a");

    // One noisy address must not lock everybody else out.
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("lets a caller back in once its oldest hit leaves the window", () => {
    const clock = { now: 1_000 };
    const limiter = limiterAt(clock);

    for (let i = 0; i < 3; i++) limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    clock.now += 60_001;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("slides rather than resetting on a fixed boundary", () => {
    // A fixed-bucket limiter lets a caller spend the whole budget at the end of
    // one bucket and the whole budget again at the start of the next.
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    limiter.check("a");
    clock.now += 30_000;
    limiter.check("a");
    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    // The first hit ages out here, and exactly one slot opens with it.
    clock.now += 30_001;
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("reports a retry-after that is never zero", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    for (let i = 0; i < 3; i++) limiter.check("a");

    const refused = limiter.check("a");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);

    // A caller one millisecond short of the window still gets told to wait a
    // second, not to come straight back and be refused again.
    clock.now += 59_999;
    expect(limiter.check("a").retryAfterSeconds).toBe(1);
  });

  it("forgets callers who have gone quiet, so the table tracks the active few", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    limiter.check("a");
    limiter.check("b");
    expect(limiter.size()).toBe(2);

    clock.now += 60_001;
    limiter.check("c");

    expect(limiter.size()).toBe(1);
  });

  it("stays bounded when a caller cycles addresses", () => {
    // Otherwise the limiter is itself the denial of service: unbounded growth
    // driven by whoever is being limited.
    const clock = { now: 0 };
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 60_000,
      maxKeys: 5,
      now: () => clock.now,
    });

    for (let i = 0; i < 100; i++) limiter.check(`caller-${i}`);

    expect(limiter.size()).toBeLessThanOrEqual(5);
    // And a fresh caller is still counted rather than silently waved through.
    expect(limiter.check("caller-new").allowed).toBe(true);
  });
});
