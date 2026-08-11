"use client";

import type { ReactNode } from "react";
import { useDemoHidden } from "@/lib/demo/demoVisibility";

/**
 * Swaps already-rendered schedule content for its empty state while the
 * DEMO_MODE toggle is on (AGENTS.md §13 Phase 4.0).
 *
 * Deliberately dumb: `children` and `empty` both arrive as server-rendered
 * JSX, grouped and formatted by the schedule page exactly as it always was —
 * this component does no data work, it only picks which finished subtree to
 * mount. That keeps `groupDancesByDay` and `DanceRow` server-only, and keeps
 * this file's own client bundle to one boolean read.
 *
 * The schedule page only renders this at all when `NEXT_PUBLIC_DEMO_MODE` is
 * set, so it never ships to a production build.
 */
export function DemoVisibilityGate({
  children,
  empty,
}: {
  children: ReactNode;
  empty: ReactNode;
}) {
  const hidden = useDemoHidden();
  return <>{hidden ? empty : children}</>;
}
