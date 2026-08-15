import { describe, expect, it } from "vitest";
import { roleFor, showsInstructorTools } from "@/lib/domain/role";

/**
 * The role derivation (docs/decisions/0018). Small, because the design is: the
 * role is a reading of one row's existence, and there is deliberately nothing
 * else to it.
 *
 * What these lock down is the *shape* of that — that "no instructor row" means
 * dancer rather than "unknown" or an error, and that nothing else is consulted.
 * A future version that reached for a stored column would have to change these.
 */

describe("roleFor — the role is the instructor row, and nothing else", () => {
  it("reads a profile with no instructor row as a רוקד", () => {
    expect(roleFor(null)).toBe("dancer");
  });

  it("reads a profile that owns an instructor row as a מרקיד", () => {
    expect(roleFor({ id: "any-instructor-id" })).toBe("instructor");
  });

  it("does not care what is IN the row — only that there is one", () => {
    // Nothing about `verified` reaches this. Unverified instructors publish
    // (docs/decisions/0004), so a role that changed with the flag would be
    // describing a permission the database does not actually enforce.
    expect(roleFor({ id: "unverified" })).toBe("instructor");
  });
});

describe("showsInstructorTools — a drawing decision, not a permission", () => {
  it("offers the instructor surfaces to a מרקיד only", () => {
    expect(showsInstructorTools("instructor")).toBe(true);
    expect(showsInstructorTools("dancer")).toBe(false);
  });
});
