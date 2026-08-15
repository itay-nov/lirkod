import type { UserRole } from "@/lib/domain/role";

/**
 * The complete, fixed cast a demo sign-in can land on — and nothing else.
 *
 * This table is the second of the four independent barriers described in
 * docs/decisions/0018, and the one that answers "could somebody type a number
 * that logs them into a real account?". They could not: the typed number is an
 * INDEX INTO THIS ARRAY, never a search for an account whose phone matches it.
 * A number outside the array has no account to resolve to, so there is no input
 * — well-formed or not — that reaches a person we did not seed ourselves.
 *
 * Say that the other way round, because it is the property under review: this
 * file is not a filter over real users. It is the entire universe of users the
 * demo path knows how to name.
 *
 * These same phones appear in two other places, and all three move together:
 * `[auth.sms.test_otp]` in `supabase/config.toml` (so the real OTP exchange
 * resolves them locally without sending an SMS) and `supabase/seed.sql` (which
 * creates the accounts). A phone here with no seeded account simply fails to
 * sign in — the failure is a refusal, never a fabricated session.
 *
 * Deliberately in `src/lib/auth/` rather than `domain/`: it is environment
 * furniture for one gated path, not business logic (AGENTS.md §4).
 */
export interface DemoUser {
  /** E.164, matching the seeded `auth.users.phone` exactly. */
  phone: string;
  /**
   * What this account IS in the seed, not a permission being granted here.
   * "instructor" means seed.sql gave it an `instructors` row; the role the app
   * shows is still derived from that row at read time (`roleFor`), never from
   * this field. Kept only so the sign-in screen can name who you are about to
   * become before you press אישור.
   */
  role: UserRole;
  /** The seeded `profiles.display_name`. Shown on the demo form for the same reason. */
  displayName: string;
}

/**
 * Index 0 is the מרקיד; 1 and up are רוקדים. That ordering is the product's,
 * not an implementation detail — "type 0 for the instructor" is the convention
 * the demo is driven by, so it is fixed here rather than sorted or configured.
 */
export const DEMO_USERS: readonly DemoUser[] = [
  { phone: "+972500009000", role: "instructor", displayName: "אורי מרקיד" },
  { phone: "+972500009001", role: "dancer", displayName: "נועה" },
  { phone: "+972500009002", role: "dancer", displayName: "דוד" },
  { phone: "+972500009003", role: "dancer", displayName: "רותי" },
];

/**
 * The one fixed code every seeded demo account verifies with, matching
 * `[auth.sms.test_otp]`. Not a secret and not treated as one — it is a constant
 * of the local stack's configuration, and it only means anything for phones that
 * stack has been told are test numbers.
 */
export const DEMO_OTP = "123456";

/**
 * The demo account for a typed number, or null if there is not one.
 *
 * Null is the answer for every kind of bad input — a negative number, a
 * fractional one, an index past the end of the cast, or something that was never
 * a number. The caller turns all of those into the same refusal, because from
 * the outside they are the same event: a number that names nobody.
 *
 * Pure, so `tests/unit/demoUsers.test.ts` can pin the mapping without a stack.
 */
export function demoUserFor(typedNumber: string): DemoUser | null {
  const trimmed = typedNumber.trim();
  if (trimmed === "") return null;

  // Digits only, checked before indexing rather than after. `Number()` alone
  // would accept "1e1" as 10 and "0x2" as 2 — neither is something a person
  // typed into a box that says "type 0 or 1", and both would quietly resolve to
  // an account other than the one they named. Surrounding whitespace IS
  // forgiven (trimmed above), because " 1 " is unambiguous and being strict
  // about it would only punish whoever is presenting.
  if (!/^\d+$/.test(trimmed)) return null;

  const index = Number(trimmed);
  if (!Number.isSafeInteger(index)) return null;

  return DEMO_USERS[index] ?? null;
}
