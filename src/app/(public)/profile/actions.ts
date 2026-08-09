"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/auth/serverClient";
import { currentUser } from "@/lib/auth/session";
import { publishDance } from "@/lib/db/dances";
import {
  createOwnProfile,
  findOwnInstructor,
  findOwnProfile,
  registerAsInstructor,
} from "@/lib/db/publisher";
import { buildNewDance, type NewDanceField } from "@/lib/domain/newDance";

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
  | { ok: true }
  | { ok: false; reason: "signedOut" | "noProfile" | "failed" }
  | { ok: false; reason: "invalid"; problems: Array<{ field: NewDanceField }> };

export interface PublishDanceInput {
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
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

  const built = buildNewDance({
    venueId: input.venueId,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
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

  await publishDance(client, {
    instructorId: instructor.id,
    venueId: built.command.venueId,
    startsAtUtc: built.command.startsAtUtc,
    endsAtUtc: built.command.endsAtUtc,
  });

  // The map and the schedule read live occurrence rows, so a newly published
  // night has to invalidate them too — not just the screen it was created from.
  revalidatePath("/profile");
  revalidatePath("/");
  revalidatePath("/schedule");

  return { ok: true };
}
