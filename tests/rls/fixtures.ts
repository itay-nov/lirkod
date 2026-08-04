import {
  PHONE_DANCER,
  PHONE_INSTRUCTOR_A,
  PHONE_INSTRUCTOR_B,
  point,
  serviceClient,
  type Client,
} from "./helpers";

/**
 * Every fixture venue is named with this prefix so teardown can find and remove
 * exactly what the suite created, instead of truncating a developer's local data.
 */
const FIXTURE_PREFIX = "rls-test-";

export interface Fixtures {
  profileAId: string;
  profileBId: string;
  dancerProfileId: string;
  instructorAId: string;
  instructorBId: string;
  venue1Id: string;
  venue2Id: string;
  eventAId: string;
  eventBId: string;
  occurrenceAId: string;
  occurrenceBId: string;
  cancelledOccurrenceId: string;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`fixture setup failed (${what}): ${result.error.message}`);
  if (result.data === null) throw new Error(`fixture setup returned no row for ${what}`);
  return result.data;
}

async function createUser(service: Client, phone: string): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
  });
  if (error) throw new Error(`could not create test user ${phone}: ${error.message}`);
  if (!data.user) throw new Error(`no user returned for ${phone}`);
  return data.user.id;
}

async function createProfile(
  service: Client,
  id: string,
  displayName: string,
  phone: string,
): Promise<void> {
  const { error } = await service
    .from("profiles")
    .insert({ id, display_name: displayName, phone });
  if (error) throw new Error(`could not create profile ${displayName}: ${error.message}`);
}

export async function teardown(): Promise<void> {
  const service = serviceClient();

  const { data: venues } = await service
    .from("venues")
    .select("id")
    .like("name", `${FIXTURE_PREFIX}%`);

  const venueIds = (venues ?? []).map((v) => v.id);

  if (venueIds.length > 0) {
    const { data: events } = await service
      .from("dance_events")
      .select("id")
      .in("venue_id", venueIds);

    const eventIds = (events ?? []).map((e) => e.id);
    if (eventIds.length > 0) {
      // Occurrences cascade from dance_events, but an occurrence whose
      // override_venue_id points at a fixture venue would otherwise block the
      // venue delete (on delete restrict).
      await service.from("event_occurrences").delete().in("event_id", eventIds);
      await service.from("dance_events").delete().in("id", eventIds);
    }
    await service.from("venues").delete().in("id", venueIds);
  }

  // Deleting the auth user cascades to profiles and then to instructors.
  const { data: users } = await service.auth.admin.listUsers();
  const testPhones = new Set(
    [PHONE_INSTRUCTOR_A, PHONE_INSTRUCTOR_B, PHONE_DANCER].map((p) => p.replace("+", "")),
  );
  for (const user of users?.users ?? []) {
    if (user.phone && testPhones.has(user.phone)) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
}

export async function setup(): Promise<Fixtures> {
  await teardown();

  const service = serviceClient();

  const profileAId = await createUser(service, PHONE_INSTRUCTOR_A);
  const profileBId = await createUser(service, PHONE_INSTRUCTOR_B);
  const dancerProfileId = await createUser(service, PHONE_DANCER);

  await createProfile(service, profileAId, "מרקיד א", PHONE_INSTRUCTOR_A);
  await createProfile(service, profileBId, "מרקיד ב", PHONE_INSTRUCTOR_B);
  await createProfile(service, dancerProfileId, "רוקדת", PHONE_DANCER);

  const instructors = unwrap(
    await service
      .from("instructors")
      .insert([
        { profile_id: profileAId, display_name: "דנה מרקידה", bio: "bio a" },
        { profile_id: profileBId, display_name: "יוסי מרקיד", bio: "bio b" },
      ])
      .select("id, profile_id"),
    "instructors",
  );
  const instructorAId = instructors.find((i) => i.profile_id === profileAId)?.id;
  const instructorBId = instructors.find((i) => i.profile_id === profileBId)?.id;
  if (!instructorAId || !instructorBId) throw new Error("instructor fixtures missing");

  const venues = unwrap(
    await service
      .from("venues")
      .insert([
        {
          name: `${FIXTURE_PREFIX}beit-hachayal`,
          address: "רחוב ויצמן 60, תל אביב",
          location: point(34.7896, 32.0853),
          capacity: 200,
          is_accessible: true,
        },
        {
          name: `${FIXTURE_PREFIX}moadon-hakfar`,
          address: "הרצל 1, רמת גן",
          location: point(34.8103, 32.0684),
        },
      ])
      .select("id, name"),
    "venues",
  );
  const venue1Id = venues.find((v) => v.name.endsWith("beit-hachayal"))?.id;
  const venue2Id = venues.find((v) => v.name.endsWith("moadon-hakfar"))?.id;
  if (!venue1Id || !venue2Id) throw new Error("venue fixtures missing");

  const events = unwrap(
    await service
      .from("dance_events")
      .insert([
        {
          instructor_id: instructorAId,
          venue_id: venue1Id,
          dance_types: ["הרקדה", "זוגות"],
          recurrence_rule: "FREQ=WEEKLY;BYDAY=TU",
          price_agorot: 4000,
        },
        {
          instructor_id: instructorBId,
          venue_id: venue1Id,
          dance_types: ["הרקדה"],
          recurrence_rule: "FREQ=WEEKLY;BYDAY=TH",
          price_agorot: 3500,
        },
      ])
      .select("id, instructor_id"),
    "dance_events",
  );
  const eventAId = events.find((e) => e.instructor_id === instructorAId)?.id;
  const eventBId = events.find((e) => e.instructor_id === instructorBId)?.id;
  if (!eventAId || !eventBId) throw new Error("event fixtures missing");

  const occurrences = unwrap(
    await service
      .from("event_occurrences")
      // status is spelled out on every row: a bulk insert through PostgREST uses the
      // union of all keys, so a row that omits it is sent an explicit NULL rather than
      // falling back to the column default.
      .insert([
        {
          event_id: eventAId,
          starts_at: "2026-09-01T17:00:00Z",
          ends_at: "2026-09-01T20:00:00Z",
          status: "scheduled",
        },
        {
          event_id: eventBId,
          starts_at: "2026-09-03T17:00:00Z",
          ends_at: "2026-09-03T20:00:00Z",
          status: "scheduled",
        },
        {
          event_id: eventAId,
          starts_at: "2026-09-08T17:00:00Z",
          ends_at: "2026-09-08T20:00:00Z",
          status: "cancelled",
          cancellation_reason: "המרקיד חולה",
          overridden_at: "2026-08-30T09:00:00Z",
        },
      ])
      .select("id, event_id, status"),
    "event_occurrences",
  );
  const occurrenceAId = occurrences.find(
    (o) => o.event_id === eventAId && o.status === "scheduled",
  )?.id;
  const occurrenceBId = occurrences.find((o) => o.event_id === eventBId)?.id;
  const cancelledOccurrenceId = occurrences.find((o) => o.status === "cancelled")?.id;
  if (!occurrenceAId || !occurrenceBId || !cancelledOccurrenceId) {
    throw new Error("occurrence fixtures missing");
  }

  return {
    profileAId,
    profileBId,
    dancerProfileId,
    instructorAId,
    instructorBId,
    venue1Id,
    venue2Id,
    eventAId,
    eventBId,
    occurrenceAId,
    occurrenceBId,
    cancelledOccurrenceId,
  };
}
