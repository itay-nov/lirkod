"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { loadTurnstile } from "@/lib/auth/turnstile";

export interface SecurityCheckHandle {
  /**
   * A fresh, unspent challenge token, or null if the challenge is unavailable.
   *
   * Waits rather than failing fast when the challenge has not resolved yet. On a
   * slow connection the widget can still be working when a fast typist presses
   * the button, and refusing them at that moment would look exactly like being
   * wrongly accused of being a robot (AGENTS.md §2 — this audience will not
   * retry, they will leave).
   */
  token(): Promise<string | null>;
  /** Discards the spent token and re-runs the challenge. Tokens are single-use. */
  reset(): void;
}

/**
 * Cloudflare Turnstile, wrapped so the sign-in form deals in "give me a token"
 * rather than in widget ids and global callbacks.
 *
 * Why there is a challenge on this form at all: every press of "שליחת קוד" asks
 * Supabase to spend money on an SMS, and GoTrue enforces the challenge on
 * `/auth/v1/otp` itself — so unlike a check we could write in a route handler,
 * this one is not bypassable by skipping our UI and calling Supabase REST with
 * the anon key straight out of the JavaScript bundle. See docs/decisions/0013.
 *
 * Turnstile's managed mode usually resolves with nothing for the dancer to do,
 * which is why it was chosen over hCaptcha's checkbox. "Usually" is not "always":
 * traffic it scores as suspicious still gets an interactive challenge, so this
 * renders a real, labelled, reachable region rather than a hidden one.
 */
export function SecurityCheck({
  siteKey,
  label,
  onUnavailable,
  ref,
}: {
  siteKey: string;
  label: string;
  /** Called once if the challenge cannot load at all. Sign-in is then impossible. */
  onUnavailable: () => void;
  ref?: Ref<SecurityCheckHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const apiRef = useRef<TurnstileApi | null>(null);
  const tokenRef = useRef<string | null>(null);
  /** Callers parked in `token()` while the challenge is still working. */
  const waitingRef = useRef<Array<(token: string | null) => void>>([]);

  // Kept current without being a dependency of the render effect below: that
  // effect must not tear down a solved widget just because the parent re-rendered
  // with a new closure. Assigned in an effect rather than during render, which is
  // both the documented pattern and what `react-hooks/refs` enforces.
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  const settle = useCallback((token: string | null) => {
    tokenRef.current = token;
    const waiting = waitingRef.current;
    waitingRef.current = [];
    for (const resolve of waiting) resolve(token);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadTurnstile()
      .then((api) => {
        const container = containerRef.current;
        if (cancelled || !container) return;

        apiRef.current = api;
        widgetIdRef.current = api.render(container, {
          sitekey: siteKey,
          language: "he",
          size: "flexible",
          callback: (token) => {
            settle(token);
          },
          // A token that expires unspent must not be sent — GoTrue would refuse
          // it and the dancer would be told the check failed for no visible
          // reason. Clear it and let Turnstile issue another.
          "expired-callback": () => {
            tokenRef.current = null;
            api.reset(widgetIdRef.current);
          },
          "error-callback": () => {
            // Unblocks anyone waiting in `token()` instead of leaving the form
            // stuck on "שולחים קוד…" for ever.
            settle(null);
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        settle(null);
        onUnavailableRef.current();
      });

    return () => {
      cancelled = true;
      const api = apiRef.current;
      const widgetId = widgetIdRef.current;
      if (api && widgetId !== undefined) api.remove(widgetId);
      // Anything still waiting would otherwise hang on a promise nothing can
      // resolve now that the widget is gone.
      settle(null);
    };
  }, [siteKey, settle]);

  useImperativeHandle(ref, () => ({
    token(): Promise<string | null> {
      if (tokenRef.current !== null) return Promise.resolve(tokenRef.current);
      return new Promise((resolve) => {
        waitingRef.current.push(resolve);
      });
    },
    reset(): void {
      tokenRef.current = null;
      apiRef.current?.reset(widgetIdRef.current);
    },
  }));

  return (
    <div
      ref={containerRef}
      // A region rather than a bare div: when Turnstile does ask for an
      // interaction, it arrives as an unlabelled cross-origin iframe in the
      // middle of a form, which is not something a screen reader user can
      // orient in.
      role="group"
      aria-label={label}
      className="pt-2"
    />
  );
}
