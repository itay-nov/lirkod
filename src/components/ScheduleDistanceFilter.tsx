"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DistanceFilter, type DistanceFilterLabels } from "@/components/DistanceFilter";
import type { DistanceRadiusMeters } from "@/lib/domain/distanceFilter";
import { DEFAULT_RADIUS_METERS } from "@/lib/domain/defaultRegion";

/** Updates the schedule radius in the URL so the Server Component re-runs PostGIS. */
export function ScheduleDistanceFilter({
  radiusMeters,
  labels,
}: {
  radiusMeters: DistanceRadiusMeters;
  labels: DistanceFilterLabels;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useOptimistic(radiusMeters);
  const [pending, startTransition] = useTransition();

  function changeRadius(next: DistanceRadiusMeters) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_RADIUS_METERS) params.delete("radius");
    else params.set("radius", String(next));

    const query = params.toString();
    startTransition(() => {
      setSelected(next);
      router.replace(query === "" ? pathname : `${pathname}?${query}`, { scroll: false });
    });
  }

  return (
    <DistanceFilter
      radiusMeters={selected}
      onChange={changeRadius}
      labels={labels}
      busy={pending}
    />
  );
}
