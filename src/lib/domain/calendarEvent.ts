/**
 * A single-VEVENT .ics file for one night, and the `data:` URL that hands it to
 * the browser as a download.
 *
 * `startUtcIso`/`endUtcIso` are stored as UTC `timestamptz` already (AGENTS.md
 * §7), so this needs no timezone conversion and no date-library dependency
 * (§13) — RFC 5545's `Z`-suffixed UTC form is exactly what a UTC instant
 * formats to directly. Compare `jerusalemTime.ts`, which exists for the
 * opposite direction: a wall-clock time an instructor typed, with no offset of
 * its own, turned into the instant we store. There is no wall clock here.
 *
 * Pure and DOM-free, so it is testable without jsdom (AGENTS.md §3).
 */

export interface CalendarEventInput {
  /** The occurrence id — unique and stable, so a re-added event replaces rather than duplicates. */
  uid: string;
  title: string;
  location: string;
  /** ISO-8601 UTC. */
  startUtcIso: string;
  /** ISO-8601 UTC, after startUtcIso. */
  endUtcIso: string;
  /** When the file was generated — DTSTAMP. Injectable so the builder stays pure and testable. */
  now: Date;
}

function parseUtc(iso: string, field: string): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} is not a parseable timestamp: ${iso}`);
  }
  return date;
}

/** "20260818T173000Z" — RFC 5545 §3.3.5 UTC form. */
function icsTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * RFC 5545 §3.3.11 TEXT escaping. Backslash first, or escaping the other three
 * characters would double-escape the backslashes those steps themselves insert.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");
}

/**
 * One VCALENDAR, one VEVENT. Line folding (RFC 5545 §3.1, wrapping any line
 * over 75 octets) is deliberately not implemented: every field here is a
 * venue name, an address, or a short title, and none of the calendar apps this
 * audience uses (Google Calendar, Apple Calendar, WhatsApp's own preview) has
 * ever needed it in practice for text this short — see AGENTS.md §13, don't
 * build for a case the actual inputs cannot reach.
 */
export function buildIcsEvent(input: CalendarEventInput): string {
  const start = parseUtc(input.startUtcIso, "startUtcIso");
  const end = parseUtc(input.endUtcIso, "endUtcIso");

  if (end.getTime() <= start.getTime()) {
    throw new Error(
      `endUtcIso (${input.endUtcIso}) must be after startUtcIso (${input.startUtcIso})`,
    );
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lirkod//dance-night//HE",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    // One `.ics` per occurrence, never per series — a recurring dance's nights
    // can each be individually cancelled or moved (docs/decisions/0003), so a
    // single RRULE VEVENT would go stale the first time that happens.
    `UID:${escapeIcsText(input.uid)}@lirkod.app`,
    `DTSTAMP:${icsTimestamp(input.now)}`,
    `DTSTART:${icsTimestamp(start)}`,
    `DTEND:${icsTimestamp(end)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  // CRLF per RFC 5545 §3.1 — not the platform newline.
  return lines.join("\r\n") + "\r\n";
}

/** A `data:` URL a plain `<a download>` can hand straight to the browser. */
export function icsDataUrl(icsContent: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
}
