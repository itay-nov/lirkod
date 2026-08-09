"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/auth/browserClient";
import { he } from "@/lib/i18n/he";

/**
 * The only interactive part of the signed-in profile, kept to its own client
 * component so the rest of that screen stays server-rendered — the same split
 * TabBar and DanceRingScroller already use (AGENTS.md §2.9, §6).
 *
 * Signing out from the browser rather than through a server action is what keeps
 * the two halves of the session in step: `browserClient` owns the cookies, so it
 * is the thing that can actually clear them. `router.refresh()` then makes the
 * server look again and render the signed-out screen.
 */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut(): Promise<void> {
    setBusy(true);
    try {
      await browserClient().auth.signOut();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="min-h-12 w-full rounded-lg border-2 border-secondary px-4 py-3 text-secondary focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-secondary disabled:opacity-70"
    >
      {busy ? he.profile.signingOut : he.profile.signOut}
    </button>
  );
}
