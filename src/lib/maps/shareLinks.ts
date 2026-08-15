/**
 * WhatsApp's share intent (AGENTS.md §2.1 — the product's main entry point is a
 * link opened inside WhatsApp, and sharing back into it closes the loop).
 *
 * Pure string builder, no DOM and no env, so it is testable without jsdom and
 * survives the Capacitor wrap (AGENTS.md §3). The message text itself is built
 * by the caller (`he.map.preview.shareText`) — this only wraps it into the
 * intent URL, the same division `navigationLinks.ts` draws between a target and
 * the link that hands it to another app.
 */

/**
 * `wa.me` with no phone number opens WhatsApp's own contact/chat picker with
 * `text` pre-filled — the documented way to start a share without knowing who
 * it goes to. `encodeURIComponent` is what keeps the newlines in a multi-line
 * message intact rather than being read as separate query parameters.
 */
export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
