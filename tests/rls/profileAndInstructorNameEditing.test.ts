import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";

/**
 * The security properties of Phase 4.3's avatar column and instructor
 * public-name edit (docs/decisions/0019), asserted live rather than assumed.
 *
 * Same two-shape convention `rls.test.ts` documents at its own top: a
 * withheld COLUMN fails at the privilege layer with 42501, before RLS is
 * even consulted; a withheld ROW (right column, wrong owner) is filtered by
 * policy instead and comes back as no error with zero rows, which every
 * negative case here re-reads through the service client to confirm nothing
 * actually moved.
 *
 * Its own dedicated phone numbers (972500000018/19, supabase/config.toml),
 * NOT `rls.test.ts`'s PHONE_INSTRUCTOR_A/B — see the comment in config.toml
 * for why reusing those would fail on an OTP cooldown unrelated to what this
 * file asserts.
 */

const PHONE_A = "+972500000018";
const PHONE_B = "+972500000019";

interface Person {
  profileId: string;
  instructorId: string;
}

async function createPerson(
  service: Client,
  phone: string,
  privateName: string,
  publicName: string,
): Promise<Person> {
  const { data: user, error: userError } = await service.auth.admin.createUser({
    phone,
    phone_confirm: true,
  });
  if (userError) throw new Error(`could not create ${phone}: ${userError.message}`);
  if (!user.user) throw new Error(`no user returned for ${phone}`);

  const { error: profileError } = await service
    .from("profiles")
    .insert({ id: user.user.id, display_name: privateName, phone });
  if (profileError) throw new Error(`could not create profile for ${phone}: ${profileError.message}`);

  const { data: instructor, error: instructorError } = await service
    .from("instructors")
    .insert({ profile_id: user.user.id, display_name: publicName })
    .select("id")
    .single();
  if (instructorError) {
    throw new Error(`could not create instructor for ${phone}: ${instructorError.message}`);
  }

  return { profileId: user.user.id, instructorId: instructor.id };
}

/** Deleting the auth user cascades to profiles and then instructors (same as fixtures.ts's teardown). */
async function removePerson(service: Client, phone: string): Promise<void> {
  const { data: users } = await service.auth.admin.listUsers();
  const bare = phone.replace("+", "");
  for (const user of users?.users ?? []) {
    if (user.phone === bare) await service.auth.admin.deleteUser(user.id);
  }
}

let service: Client;
let anon: Client;
let a: Person;
let b: Person;
let clientA: Client;
let clientB: Client;

beforeAll(async () => {
  service = serviceClient();
  anon = anonClient();
  a = await createPerson(service, PHONE_A, "פרטי א", "פומבי א");
  b = await createPerson(service, PHONE_B, "פרטי ב", "פומבי ב");
  clientA = await signInAs(PHONE_A);
  clientB = await signInAs(PHONE_B);
});

afterAll(async () => {
  await removePerson(service, PHONE_A);
  await removePerson(service, PHONE_B);
});

describe("avatar_id — an owner sets it, and the anon SELECT everyone else gets confirms it", () => {
  it("lets a signed-in user set their own avatar", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .update({ avatar_id: "man_curly" })
      .eq("id", a.profileId)
      .select("avatar_id");

    expect(error).toBeNull();
    expect(data).toEqual([{ avatar_id: "man_curly" }]);
  });

  it("(a) refuses a non-owner setting someone else's avatar — RLS row filter, not a crash", async () => {
    const { data, error } = await clientB
      .from("profiles")
      .update({ avatar_id: "dancer_figure" })
      .eq("id", a.profileId)
      .select();

    // The column is inside B's own grant — this is refused by
    // `profiles_update_own`'s USING clause matching no rows, not by the
    // privilege layer, so PostgREST reports success with nothing touched
    // rather than an error.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("profiles")
      .select("avatar_id")
      .eq("id", a.profileId)
      .single();
    expect(after?.avatar_id).toBe("man_curly");
  });
});

describe("instructors.display_name — the public-name edit that pays docs/decisions/0018's debt", () => {
  it("lets an instructor rename their own public identity", async () => {
    const { data, error } = await clientA
      .from("instructors")
      .update({ display_name: "פומבי א מעודכן" })
      .eq("id", a.instructorId)
      .select("display_name");

    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: "פומבי א מעודכן" }]);
  });

  it("(b) refuses a non-owner renaming someone else's public identity", async () => {
    const { data, error } = await clientB
      .from("instructors")
      .update({ display_name: "נחטף" })
      .eq("id", a.instructorId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("instructors")
      .select("display_name")
      .eq("id", a.instructorId)
      .single();
    expect(after?.display_name).toBe("פומבי א מעודכן");
  });

  it("the renamed public identity is what an anonymous map visitor actually sees", async () => {
    // The point of the whole split (docs/decisions/0004): a rename here is
    // immediately what a signed-out dancer reads next to a dance.
    const { data, error } = await anon
      .from("instructors")
      .select("display_name")
      .eq("id", a.instructorId)
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("פומבי א מעודכן");
  });
});

describe("(c) the grant does not widen beyond the two intended columns", () => {
  it("refuses profiles columns outside the grant, one at a time, with 42501", async () => {
    // A union of single-key shapes, not `Record<string, unknown>`: each of
    // these IS a real, individually-valid `profiles` Update column (that is
    // the whole point — none is a typo the compiler would catch on its own),
    // so the type has to say exactly that rather than an open index
    // signature, which loses per-column excess-property checking.
    const attempts: ReadonlyArray<
      { phone: string } | { home_location: string } | { id: string } | { created_at: string }
    > = [
      { phone: "+972500000099" },
      { home_location: "POINT(34.78 32.08)" },
      { id: b.profileId },
      { created_at: new Date().toISOString() },
    ];

    for (const patch of attempts) {
      const { error } = await clientA
        .from("profiles")
        .update(patch)
        .eq("id", a.profileId)
        .select();
      expect(error?.code, `patch ${JSON.stringify(patch)}`).toBe("42501");
    }
  });

  it("refuses a withheld column even alongside an allowed one, in the same statement", async () => {
    const { error } = await clientA
      .from("profiles")
      .update({ avatar_id: "pomegranate", phone: "+972500000098" })
      .eq("id", a.profileId)
      .select();

    expect(error?.code).toBe("42501");

    // Naming ANY withheld column fails the whole statement — nothing,
    // including the otherwise-valid avatar_id, was written.
    const { data: after } = await service
      .from("profiles")
      .select("avatar_id, phone")
      .eq("id", a.profileId)
      .single();
    expect(after?.avatar_id).toBe("man_curly");
    expect(after?.phone).toBe(PHONE_A);
  });

  it("refuses instructors.verified, alone and combined with display_name, and it stays false", async () => {
    const { error: aloneError } = await clientA
      .from("instructors")
      .update({ verified: true })
      .eq("id", a.instructorId)
      .select();
    expect(aloneError?.code).toBe("42501");

    const { error: combinedError } = await clientA
      .from("instructors")
      .update({ display_name: "לא ישתנה", verified: true })
      .eq("id", a.instructorId)
      .select();
    expect(combinedError?.code).toBe("42501");

    const { data: after } = await service
      .from("instructors")
      .select("verified, display_name")
      .eq("id", a.instructorId)
      .single();
    expect(after?.verified).toBe(false);
    expect(after?.display_name).toBe("פומבי א מעודכן");
  });
});

describe("(d) the private and public names never touch each other", () => {
  it("renaming the public identity leaves the private profile name unchanged", async () => {
    const { error } = await clientA
      .from("instructors")
      .update({ display_name: "פומבי שוב אחר" })
      .eq("id", a.instructorId);
    expect(error).toBeNull();

    const { data: profile } = await service
      .from("profiles")
      .select("display_name")
      .eq("id", a.profileId)
      .single();
    expect(profile?.display_name).toBe("פרטי א");
  });

  it("renaming the private profile leaves the public identity unchanged", async () => {
    const { error } = await clientA
      .from("profiles")
      .update({ display_name: "פרטי שוב אחר" })
      .eq("id", a.profileId);
    expect(error).toBeNull();

    const { data: instructor } = await service
      .from("instructors")
      .select("display_name")
      .eq("id", a.instructorId)
      .single();
    expect(instructor?.display_name).toBe("פומבי שוב אחר");
  });
});
