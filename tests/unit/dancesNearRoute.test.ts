import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/dances/near/route";

/**
 * The route's own gatekeeping, up to but not including the database.
 *
 * Every request here carries a deliberately invalid body, which is what makes
 * the test hermetic: the handler rejects it before `anonClient()` is reached,
 * so nothing needs Supabase env or a running stack. That ordering is itself
 * part of what is being asserted — the rate limit has to come first, or it is
 * only limiting how much work we do *after* deciding to do it.
 *
 * The limiter is module state shared across this file, so each test uses its
 * own source address.
 */

function post(ip: string, body: unknown = { nonsense: true }): Promise<Response> {
  return POST(
    new Request("http://localhost/api/dances/near", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/dances/near validation", () => {
  it("refuses a body that is not JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/dances/near", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" },
        body: "{not json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("refuses coordinates that are not on Earth", async () => {
    const response = await post("10.0.0.2", { lat: 91, lng: 34, radiusMeters: 1_000 });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_coordinates" });
  });

  it("refuses a radius wider than the query will ever serve", async () => {
    const response = await post("10.0.0.3", { lat: 32, lng: 34, radiusMeters: 500_000 });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/dances/near rate limiting", () => {
  it("serves a normal number of presses and then answers 429", async () => {
    const ip = "10.0.0.10";

    for (let i = 0; i < 10; i++) {
      // 400, not 200: the bodies are invalid on purpose so the handler never
      // reaches Postgres. What matters is that each one consumed budget.
      expect((await post(ip)).status, `request ${i + 1}`).toBe(400);
    }

    const refused = await post(ip);
    expect(refused.status).toBe(429);
    await expect(refused.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("tells the caller how long to wait", async () => {
    const ip = "10.0.0.11";
    for (let i = 0; i < 10; i++) await post(ip);

    const refused = await post(ip);
    const retryAfter = Number(refused.headers.get("retry-after"));

    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("does not punish a different caller for a noisy one", async () => {
    const noisy = "10.0.0.12";
    for (let i = 0; i < 11; i++) await post(noisy);
    expect((await post(noisy)).status).toBe(429);

    // A dancer on a different connection is unaffected.
    expect((await post("10.0.0.13")).status).toBe(400);
  });

  it("reads the client address from the leftmost forwarded entry", async () => {
    // x-forwarded-for accumulates proxies left to right; taking the wrong end
    // buckets every request behind one CDN address into a single budget.
    const ip = "10.0.0.14";
    for (let i = 0; i < 10; i++) await post(`${ip}, 70.0.0.1, 70.0.0.2`);

    expect((await post(ip)).status).toBe(429);
  });
});
