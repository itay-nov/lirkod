import { he } from "@/lib/i18n/he";

/**
 * A route that exists and routes correctly but has no content yet.
 *
 * Shared by the three new tabs so the "not built yet" wording lives in one
 * place — this is scaffolding with a known end date, and it should be one
 * deletion when the real screens land, not three.
 */
export function PlaceholderScreen({ heading }: { heading: string }) {
  return (
    <div className="px-4 py-6">
      <h1 className="font-display text-3xl font-black">{heading}</h1>
      <p className="pt-4">{he.common.screenNotReady}</p>
    </div>
  );
}
