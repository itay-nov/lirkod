import type { OwnDanceFlyer } from "@/lib/db/dances";
import { toManageableDanceFlyers } from "@/lib/domain/manageDanceFlyers";
import { he } from "@/lib/i18n/he";
import { DanceFlyerEditor } from "./DanceFlyerEditor";

export function ManageDanceFlyers({ dances }: { dances: readonly OwnDanceFlyer[] }) {
  if (dances.length === 0) return null;
  const manageableDances = toManageableDanceFlyers(dances);

  return (
    <section className="pt-8">
      <h2 className="font-display text-2xl font-black">{he.manageFlyers.heading}</h2>
      <p className="pt-4">{he.manageFlyers.intro}</p>
      <ul aria-label={he.manageFlyers.listLabel} className="flex flex-col gap-4 pt-4">
        {manageableDances.map((dance) => (
          <li key={dance.eventId}>
            <DanceFlyerEditor
              eventId={dance.eventId}
              danceLabel={dance.danceLabel}
              initialFlyerUrl={dance.flyerUrl}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
