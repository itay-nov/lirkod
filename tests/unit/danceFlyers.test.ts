import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_DANCE_FLYER_BYTES,
  danceFlyerPath,
  removeDanceFlyer,
  saveDanceFlyer,
  validateDanceFlyer,
} from "@/lib/storage/danceFlyers";
import type { Client } from "@/lib/db/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dance flyer validation", () => {
  it.each(["image/jpeg", "image/png", "image/webp"])("accepts %s at the size limit", (type) => {
    expect(validateDanceFlyer({ type, size: MAX_DANCE_FLYER_BYTES })).toBeNull();
  });

  it("refuses a file larger than 5 MiB", () => {
    expect(
      validateDanceFlyer({ type: "image/jpeg", size: MAX_DANCE_FLYER_BYTES + 1 }),
    ).toBe("tooLarge");
  });

  it("refuses non-image and unapproved image formats", () => {
    expect(validateDanceFlyer({ type: "application/pdf", size: 10 })).toBe("notImage");
    expect(validateDanceFlyer({ type: "image/svg+xml", size: 10 })).toBe("notImage");
  });

  it("uses a versioned RLS-recognised object path for a dance", () => {
    expect(danceFlyerPath("event-id", "version-id")).toBe("event-id/flyer-version-id");
  });

  it("keeps the attached replacement when deleting the unreferenced old object fails", async () => {
    const eventId = "event-id";
    const oldPath = `${eventId}/flyer-old`;
    const newPath = `${eventId}/flyer-00000000-0000-4000-8000-000000000001`;
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    const remove = vi.fn(async (paths: string[]) => ({
      data: null,
      error: paths[0] === oldPath ? new Error("cleanup failed") : null,
    }));
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(async () => ({ data: [{ id: eventId }], error: null })),
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { flyer_path: oldPath },
              error: null,
            })),
          })),
        })),
        update,
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ data: { path: newPath }, error: null })),
          remove,
          getPublicUrl: vi.fn(() => ({ data: { publicUrl: `https://example.test/${newPath}` } })),
        })),
      },
    } as unknown as Client;

    await expect(
      saveDanceFlyer(client, eventId, { type: "image/png", size: 1 } as File),
    ).resolves.toEqual({
      url: `https://example.test/${newPath}`,
      oldFlyerCleanupFailed: true,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([oldPath]);
  });

  it("deletes a newly uploaded object when attaching its database pointer fails", async () => {
    const eventId = "event-id";
    const newPath = `${eventId}/flyer-00000000-0000-4000-8000-000000000002`;
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000002",
    });

    const remove = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { flyer_path: null },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(async () => ({
              data: [],
              error: new Error("attach failed"),
            })),
          })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ data: { path: newPath }, error: null })),
          remove,
        })),
      },
    } as unknown as Client;

    await expect(
      saveDanceFlyer(client, eventId, { type: "image/png", size: 1 } as File),
    ).rejects.toThrow("attach failed");
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([newPath]);
  });

  it("restores the database pointer when object removal fails", async () => {
    const eventId = "event-id";
    const path = `${eventId}/flyer-existing`;
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(async () => ({ data: [{ id: eventId }], error: null })),
      })),
    }));
    const remove = vi.fn(async () => ({ data: null, error: new Error("remove failed") }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { flyer_path: path },
              error: null,
            })),
          })),
        })),
        update,
      })),
      storage: { from: vi.fn(() => ({ remove })) },
    } as unknown as Client;

    await expect(removeDanceFlyer(client, eventId)).rejects.toThrow("remove failed");
    expect(update).toHaveBeenNthCalledWith(1, { flyer_path: null });
    expect(update).toHaveBeenNthCalledWith(2, { flyer_path: path });
    expect(remove).toHaveBeenCalledWith([path]);
  });

  it("preserves the object and surfaces a failed pointer restoration", async () => {
    const eventId = "event-id";
    const path = `${eventId}/flyer-existing`;
    const update = vi
      .fn()
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          select: vi.fn(async () => ({ data: [{ id: eventId }], error: null })),
        })),
      })
      .mockReturnValueOnce({
        eq: vi.fn(() => ({
          select: vi.fn(async () => ({
            data: [],
            error: new Error("restore failed"),
          })),
        })),
      });
    const remove = vi.fn(async () => ({ data: null, error: new Error("remove failed") }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: { flyer_path: path },
              error: null,
            })),
          })),
        })),
        update,
      })),
      storage: { from: vi.fn(() => ({ remove })) },
    } as unknown as Client;

    await expect(removeDanceFlyer(client, eventId)).rejects.toThrow("restore failed");
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith([path]);
  });
});
