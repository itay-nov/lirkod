import { describe, expect, it } from "vitest";
import { DEMO_USERS, demoUserFor } from "@/lib/auth/demoUsers";

/**
 * The demo cast and the number→account mapping (docs/decisions/0018).
 *
 * The live half of this — that these phones really belong to the seeded
 * accounts, and that a dancer among them is still refused instructor writes by
 * Postgres — is `tests/rls/roleAndDemoLogin.test.ts`. What is pinned HERE is the
 * part that is pure: which inputs resolve at all, and to whom.
 */

describe("the demo cast is the convention the demo is driven by", () => {
  it("puts the מרקיד at 0 and רוקדים after, with exactly one מרקיד", () => {
    // "Type 0 for the instructor" is a spoken instruction during a demo, so the
    // ordering is a contract rather than an implementation detail.
    expect(DEMO_USERS[0]?.role).toBe("instructor");
    expect(DEMO_USERS.slice(1).every((u) => u.role === "dancer")).toBe(true);
    expect(DEMO_USERS.filter((u) => u.role === "instructor")).toHaveLength(1);
  });

  it("keeps every phone in E.164, distinct, and inside the demo 9000-range", () => {
    // The range is what keeps these visually separate from the test fixtures at
    // 972500000001-17, and a duplicate would mean two indices sharing one account.
    for (const user of DEMO_USERS) {
      expect(user.phone).toMatch(/^\+9725000090\d{2}$/);
    }
    expect(new Set(DEMO_USERS.map((u) => u.phone)).size).toBe(DEMO_USERS.length);
  });
});

describe("demoUserFor — an index into a fixed table, never a phone lookup", () => {
  it("resolves each seeded index to its own account", () => {
    for (const [index, user] of DEMO_USERS.entries()) {
      expect(demoUserFor(String(index))).toEqual(user);
    }
  });

  it("forgives surrounding whitespace, because it is unambiguous", () => {
    expect(demoUserFor(" 0 ")).toEqual(DEMO_USERS[0]);
    expect(demoUserFor("\t1\n")).toEqual(DEMO_USERS[1]);
  });

  it("resolves nobody for anything that is not a plain index", () => {
    // The security property, stated as a table: none of these names an account.
    // A phone number is in here on purpose — "any number logs into the matching
    // real user" is the exact failure this design exists to make impossible.
    const namesNobody = [
      "",
      " ",
      "abc",
      "-1",
      "1.5",
      "1e1", // 10 under Number()
      "0x1", // 1 under Number()
      "+1",
      "٠", // Arabic-Indic zero — a digit to a person, not to /^\d+$/
      "0501234567",
      "972500009000",
      String(DEMO_USERS.length), // one past the end of the cast
      "999999999999999999999",
    ];

    for (const typed of namesNobody) {
      expect(demoUserFor(typed), `typed ${JSON.stringify(typed)}`).toBeNull();
    }
  });
});
