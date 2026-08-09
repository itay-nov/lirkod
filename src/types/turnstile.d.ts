/**
 * Cloudflare Turnstile's browser API, declared rather than depended on.
 *
 * There is an `@types` package for this, but pulling a dependency in for one
 * global whose surface we use four members of is what AGENTS.md §13 rules out.
 * Same treatment `src/types/google-maps.d.ts` gives the Maps library.
 */
interface TurnstileRenderOptions {
  sitekey: string;
  /** Called with a solved token. The token is single-use and expires. */
  callback: (token: string) => void;
  /** Called when a previously solved token expires before it was spent. */
  "expired-callback"?: () => void;
  /** Called when the challenge itself fails — network, blocked host, bad key. */
  "error-callback"?: () => void;
  /**
   * Turnstile renders its own text. Left at Cloudflare's default it puts English
   * on a Hebrew screen, which AGENTS.md §2.8 rules out even for words that are
   * not ours.
   */
  language?: string;
  /** "normal" | "flexible" | "compact" — how much room the widget takes. */
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  /** Discards the current token and re-runs the challenge. */
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

interface Window {
  turnstile?: TurnstileApi;
  /** The global Turnstile calls once its script has finished bootstrapping. */
  __lirkodTurnstileReady?: () => void;
}
