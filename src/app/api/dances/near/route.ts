import { NextResponse } from "next/server";
import { anonClient } from "@/lib/db/client";
import { findDancesNear } from "@/lib/db/dances";
import { toMapDances, type MapDance } from "@/lib/maps/mapDance";

/**
 * The same proximity query the map page runs on the server, re-run for a
 * dancer who has just granted location permission (AGENTS.md §9 — render the
 * default region first, refine only if granted).
 *
 * Why a route handler and not a fetch from the component: AGENTS.md §6 keeps
 * queries in `src/lib/db/` and out of components entirely, so the browser needs
 * a server endpoint to ask through. It returns the same `MapDance[]` the page
 * builds, so the client component never formats a time or looks up a Hebrew
 * string — see the note in `mapDance.ts`.
 *
 * Why POST for what is a read: the body carries the dancer's actual position.
 * On a GET that goes in the query string, and from there into browser history,
 * the Referer header, and every access log between here and the server — a
 * precise home location, logged, for a query whose answer we do not cache
 * anyway. AGENTS.md §8 asks for data minimisation and this is the cheapest
 * possible version of it.
 *
 * No new exposure: `anon` may already call `find_dances_near` directly with
 * any arguments, and migration 0003 is what bounds that (clamped radius,
 * 60-day horizon, 200 rows). This handler is a thin, equally-bounded path to
 * the same function, not a privileged one — it uses the anon key, not
 * `service_role`.
 */

interface NearRequest {
  lat: number;
  lng: number;
  radiusMeters: number;
}

/** Wider than any radius the UI sends; find_dances_near clamps to 50km regardless. */
const MAX_RADIUS_METERS = 50_000;

function readFiniteNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRequest(payload: unknown): NearRequest | null {
  if (typeof payload !== "object" || payload === null) return null;
  const body = payload as Record<string, unknown>;

  const lat = readFiniteNumber(body, "lat");
  const lng = readFiniteNumber(body, "lng");
  const radiusMeters = readFiniteNumber(body, "radiusMeters");

  if (lat === null || lng === null || radiusMeters === null) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  if (radiusMeters <= 0 || radiusMeters > MAX_RADIUS_METERS) return null;

  return { lat, lng, radiusMeters };
}

export async function POST(request: Request): Promise<NextResponse<{ dances: MapDance[] } | { error: string }>> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    // Not swallowed (AGENTS.md §6): unparseable JSON is a client bug with
    // exactly one sensible answer, and the caller gets it as a 400.
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = parseRequest(payload);
  if (!parsed) {
    return NextResponse.json({ error: "invalid_coordinates" }, { status: 400 });
  }

  const dances = await findDancesNear(
    anonClient(),
    parsed.lat,
    parsed.lng,
    parsed.radiusMeters,
  );

  return NextResponse.json({ dances: toMapDances(dances) });
}
