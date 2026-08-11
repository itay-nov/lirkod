"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/auth/serverClient";
import { currentUser } from "@/lib/auth/session";
import type { Client } from "@/lib/db/client";
import { publishDance, publishRecurringDance } from "@/lib/db/dances";
import { cancelNight, findOwnNight, rescheduleNight } from "@/lib/db/nights";
import {
  createOwnProfile,
  findOwnInstructor,
  findOwnProfile,
  registerAsInstructor,
} from "@/lib/db/publisher";
import { findOrCreateVenue, type VenueOption } from "@/lib/db/venues";
import { buildNewDance } from "@/lib/domain/newDance";
import { buildNightTimes, type NightTimesField } from "@/lib/domain/nightTimes";
import {
  buildNewRecurringDance,
  type Repeat,
  type RecurringField,
} from "@/lib/domain/newRecurringDance";
import { buildNewVenue, type NewVenueInput } from "@/lib/domain/newVenue";

/**
 * The two writes behind /profile: set your name, and publish a dance.
 *
 * Server Actions rather than route handlers, because both are form submissions
 * whose only caller is the form next to them — a handler would mean inventing a
 * URL and a fetch for something the framework already routes (AGENTS.md §3, §13).
 *
 * Every one of them re-derives WHO IS ACTING from the session cookie via
 * `currentUser()`, and never from an argument. A Server Action is a public HTTP
 * endpoint with a generated name, not a private function — anything in its
 * parameters is client input (AGENTS.md §8). That is why neither action takes a
 * user id, a profile id or an instructor id; those are all looked up here.
 */

export type ProfileNameResult =
  | { ok: true }
  | { ok: false; reason: "signedOut" | "nameMissing" | "nameTooLong" | "failed" };

/** Matches the `length(btrim(display_name)) between 1 and 80` check in migration 0001. */
const MAX_NAME_LENGTH = 80;

export async function saveProfileName(name: string): Promise<ProfileNameResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const displayName = name.trim();
  if (displayName === "") return { ok: false, reason: "nameMissing" };
  if (displayName.length > MAX_NAME_LENGTH) return { ok: false, reason: "nameTooLong" };

  // The phone comes off the verified session, never off the form. It is the one
  // field on `profiles` that is also an identity claim, and GoTrue has already
  // proved this one with an SMS.
  const phone = user.phone === null ? null : `+${user.phone}`;
  if (phone === null) return { ok: false, reason: "failed" };

  const client = await serverClient();
  await createOwnProfile(client, { id: user.id, displayName, phone });

  revalidatePath("/profile");
  return { ok: true };
}

export type PublishDanceResult =
  | { ok: true; occurrenceCount: number }
  | { ok: false; reason: "signedOut" | "noProfile" | "noNights" | "failed" }
  | { ok: false; reason: "invalid"; problems: Array<{ field: RecurringField }> };

export interface PublishDanceInput {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** "once" keeps the single-night path; the other two publish a series. */
  repeat: Repeat;
  /** "YYYY-MM-DD" or "". Only read when `repeat` is not "once". */
  untilDate: string;
  /** The public name to publish under. Only read when there is no instructor row yet. */
  instructorName: string;
}

/**
 * Publishes one dance, registering the caller as a מרקיד on the way if this is
 * their first.
 *
 * Folding registration into the first publish is the fewer-steps option
 * (AGENTS.md §2), but the public name is still asked for explicitly rather than
 * copied from the profile. `profiles.display_name` is private and
 * `instructors.display_name` is public — that split is the whole of
 * docs/decisions/0004 — so quietly promoting one into the other would publish a
 * name the person never agreed to show. The form prefills it and lets them
 * change it; this action just takes what it is given.
 */
export async function publishDanceAction(
  input: PublishDanceInput,
): Promise<PublishDanceResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  // Validated before anything is looked up, and by whichever of the two builders
  // matches what was asked for. The recurring one runs the single-night rules
  // first and then adds its own, so a malformed time is reported the same way on
  // both paths and the form needs one error map, not two.
  const built =
    input.repeat === "once"
      ? buildNewDance({
          venueId: input.venueId,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
        })
      : buildNewRecurringDance({
          venueId: input.venueId,
          repeat: input.repeat,
          date: input.date,
          startTime: input.startTime,
          endTime: input.endTime,
          untilDate: input.untilDate,
        });

  if ("problems" in built) {
    return {
      ok: false,
      reason: "invalid",
      problems: built.problems.map(({ field }) => ({ field })),
    };
  }

  const client = await serverClient();

  // Re-read rather than trust: the profile row is what `instructors.profile_id`
  // has to point at, and the id it is looked up by comes from the verified
  // session rather than from `input`.
  const profile = await findOwnProfile(client, user.id);
  if (profile === null) return { ok: false, reason: "noProfile" };

  const instructor =
    (await findOwnInstructor(client, profile.id)) ??
    (await registerAsInstructor(client, {
      profileId: profile.id,
      displayName: input.instructorName.trim() || profile.displayName,
    }));

  // `startsAtUtc` is only on the single-night command, so this narrows the union
  // the two builders return without a second flag to keep in step with `repeat`.
  const command = built.command;
  let occurrenceCount = 1;

  if ("startsAtUtc" in command) {
    await publishDance(client, {
      instructorId: instructor.id,
      venueId: command.venueId,
      startsAtUtc: command.startsAtUtc,
      endsAtUtc: command.endsAtUtc,
    });
  } else {
    const series = await publishRecurringDance(client, {
      instructorId: instructor.id,
      venueId: command.venueId,
      freq: command.freq,
      startDate: command.startDate,
      localStartTime: command.localStartTime,
      localEndTime: command.localEndTime,
      untilDate: command.untilDate,
    });

    // Nothing was written — the whole RPC rolled back — so there is nothing to
    // revalidate and the instructor needs to change a date, not retry.
    if (!series.ok) return { ok: false, reason: series.reason };
    occurrenceCount = series.occurrenceCount;
  }

  // The map and the schedule read live occurrence rows, so a newly published
  // night has to invalidate them too — not just the screen it was created from.
  revalidatePath("/profile");
  revalidatePath("/");
  revalidatePath("/schedule");

  return { ok: true, occurrenceCount };
}

export type AddVenueResult =
  | { ok: true; venue: VenueOption }
  | { ok: false; reason: "signedOut" | "invalid" | "failed" };

/**
 * Records the hall an instructor picked out of Google Places, or hands back the
 * one already recorded for that place.
 *
 * A separate write from publishing, deliberately (docs/decisions/0015). Folding
 * it into `publish_dance` would mean a dance and a venue succeeding or failing
 * together, and a venue that outlives an abandoned publish is not a leak — it is
 * a real hall somebody confirmed exists, which is the whole point of collecting
 * clean venue data.
 *
 * Being signed in is the only authorisation: venues are shared, not owned, so
 * there is nothing here to check ownership against. The database says the same
 * thing — `venues_insert_authenticated` has no ownership clause, only
 * `place_id is not null`.
 *
 * What this cannot do is verify the place. The Maps key is referrer-restricted,
 * so the server cannot call Places itself; `buildNewVenue` constrains the payload
 * instead, and the note there is honest about the difference.
 */
export async function addVenueAction(input: NewVenueInput): Promise<AddVenueResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const built = buildNewVenue(input);
  if ("problems" in built) return { ok: false, reason: "invalid" };

  const client = await serverClient();
  const venue = await findOrCreateVenue(client, built.command);

  // The new hall has to show up in the picker's next search, which reads through
  // the route handler rather than this render — but /profile itself is cached per
  // request and would otherwise keep the pre-insert list.
  revalidatePath("/profile");

  return { ok: true, venue };
}

export type ManageNightResult =
  | { ok: true }
  | { ok: false; reason: "signedOut" | "notInstructor" | "notYours" | "failed" }
  | { ok: false; reason: "invalid"; field: NightTimesField };

/** Long enough for "תקלה במזגן באולם", short enough that it is not a notice board. */
const MAX_REASON_LENGTH = 200;

/**
 * The instructor row the caller acts as, or null if they have not got one.
 *
 * Both per-night actions below start here rather than taking an instructor id.
 * A Server Action is a public HTTP endpoint with a generated name, so anything
 * in its parameters is client input (AGENTS.md §8) — `occurrenceId` is the only
 * thing a caller gets to choose, and it is checked against this before anything
 * is written.
 *
 * That check is defence in depth, not the enforcement. The enforcement is
 * `event_occurrences_update_own` plus migration 0010's column grants, and it
 * holds for a caller who skips these actions entirely and posts to PostgREST
 * with their own token. `notYours` is what this layer says when it can tell
 * early; the database says the same thing by matching no rows, which
 * `src/lib/db/nights.ts` checks for rather than assuming a silent success.
 */
async function ownInstructorId(client: Client, userId: string): Promise<string | null> {
  const profile = await findOwnProfile(client, userId);
  if (profile === null) return null;

  const instructor = await findOwnInstructor(client, profile.id);
  return instructor?.id ?? null;
}

/** Everything a night change invalidates: the manage list and both read screens. */
function revalidateNightViews(): void {
  revalidatePath("/profile");
  revalidatePath("/");
  revalidatePath("/schedule");
}

/**
 * Takes one night off the board.
 *
 * A soft cancel, and there is deliberately no delete counterpart anywhere in
 * this codebase: the generator skips a recurrence slot because a row EXISTS in
 * it, so removing the row brings the night back on the next nightly pass
 * (docs/decisions/0017). `overridden_at` is not passed either — migration 0010's
 * trigger stamps it, so no caller can cancel a night and leave it looking
 * untouched.
 */
export async function cancelNightAction(
  occurrenceId: string,
  reason: string,
): Promise<ManageNightResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const client = await serverClient();
  const instructorId = await ownInstructorId(client, user.id);
  if (instructorId === null) return { ok: false, reason: "notInstructor" };

  const night = await findOwnNight(client, instructorId, occurrenceId);
  if (night === null) return { ok: false, reason: "notYours" };

  const trimmed = reason.trim();
  const result = await cancelNight(client, {
    occurrenceId,
    // An empty box means "no reason given", which is not the same as the empty
    // string — the column is nullable so the UI can tell the two apart.
    reason: trimmed === "" ? null : trimmed.slice(0, MAX_REASON_LENGTH),
  });

  if (!result.ok) return { ok: false, reason: result.reason };

  revalidateNightViews();
  return { ok: true };
}

/**
 * Moves one night to a different hour, in place.
 *
 * The DATE the new times are read against comes off the STORED ROW, never off
 * the form. A client that could choose it would be able to move a night to a
 * different day through a control that only offers hours, and every dancer who
 * had already planned around it would be told nothing — which is the failure
 * AGENTS.md §10 exists to prevent, arriving through the feature meant to prevent
 * it.
 */
export async function rescheduleNightAction(
  occurrenceId: string,
  startTime: string,
  endTime: string,
): Promise<ManageNightResult> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: "signedOut" };

  const client = await serverClient();
  const instructorId = await ownInstructorId(client, user.id);
  if (instructorId === null) return { ok: false, reason: "notInstructor" };

  const night = await findOwnNight(client, instructorId, occurrenceId);
  if (night === null) return { ok: false, reason: "notYours" };

  const built = buildNightTimes({ date: night.dateKey, startTime, endTime });
  if ("problems" in built) {
    return {
      ok: false,
      reason: "invalid",
      field: built.problems[0]?.field ?? "startTime",
    };
  }

  const result = await rescheduleNight(client, {
    occurrenceId,
    startsAtUtc: built.times.startsAtUtc,
    endsAtUtc: built.times.endsAtUtc,
    // Read back off the row rather than accepted from the client: this pair
    // decides what every dancer is told the night used to be (AGENTS.md §8).
    currentStartsAt: night.startsAt,
    currentOriginalStartsAt: night.originalStartsAt,
  });

  if (!result.ok) return { ok: false, reason: result.reason };

  revalidateNightViews();
  return { ok: true };
}
