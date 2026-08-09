/**
 * A fixed-budget sliding-window rate limiter.
 *
 * Pure: it holds its own counters and takes the clock as an argument, so it is
 * testable without timers, a DOM or a server (AGENTS.md §3). Nothing here
 * touches a request or a header — the caller decides what a "key" is.
 *
 * Read `docs/decisions/0012` before relying on this for anything. In short: it
 * lives in one process's memory, so it bounds what a single server instance
 * will serve and nothing more. It is a speed bump, not a wall.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the caller's oldest hit leaves the window. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Hits allowed per key per window. */
  limit: number;
  windowMs: number;
  /**
   * Ceiling on tracked keys. Without one, a caller cycling source addresses
   * turns the limiter itself into the memory leak — a denial of service run
   * through the thing meant to prevent one.
   */
  maxKeys?: number;
  now?: () => number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  /** Tracked keys. For tests and for anyone reasoning about memory. */
  size(): number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: RateLimiterOptions): RateLimiter {
  // Insertion-ordered, which is what makes the eviction below "oldest first"
  // without keeping a second index.
  const hits = new Map<string, number[]>();

  function prune(cutoff: number): void {
    for (const [key, timestamps] of hits) {
      const live = timestamps.filter((at) => at > cutoff);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    }
  }

  return {
    check(key: string): RateLimitDecision {
      const at = now();
      const cutoff = at - windowMs;

      // Sweeping on every call keeps the map proportional to *active* callers
      // rather than to everyone who has ever called.
      prune(cutoff);

      const timestamps = (hits.get(key) ?? []).filter((hit) => hit > cutoff);

      if (timestamps.length >= limit) {
        const oldest = timestamps[0] ?? at;
        return {
          allowed: false,
          // Rounded up: a Retry-After of 0 invites an immediate retry that is
          // certain to be refused again.
          retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)),
        };
      }

      if (!hits.has(key) && hits.size >= maxKeys) {
        // Full, and this is a new caller. Drop the least recently created entry
        // rather than refusing to track anyone new — a full table must not turn
        // into an accidental allow-list for whoever got there first.
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }

      timestamps.push(at);
      hits.set(key, timestamps);

      return { allowed: true, retryAfterSeconds: 0 };
    },

    size(): number {
      return hits.size;
    },
  };
}
