// The Roster emails screen's logic (docs/ux-spec.md §6.7): checking an address before it is sent,
// the list edits a sheet makes, and the screen's text. The recipients themselves live only on the
// server (ADR 0005); this module holds no copy.
import type { LastSend, Recipient } from "../api";
import type { DateString } from "../lib/dates";
import { formatDayOf, formatTime } from "../shifts/history";

/** The server's limit; Add recipient hides at it. */
export const MAX_RECIPIENTS = 10;

/** As long as an address the server accepts. */
export const EMAIL_MAX = 254;

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const INVALID_EMAIL = "Enter an email address like nan@example.com.";
export const DUPLICATE_EMAIL = "That address is already on the list.";

/** An address as the server stores it: trimmed and lower case. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Why email can't be saved as the recipient at index (null for a new one), or null when it can:
 * not like x@y.z, or already another recipient's address, ignoring case.
 */
export function emailProblem(email: string, list: readonly Recipient[], index: number | null): string | null {
  const address = normaliseEmail(email);
  if (address.length > EMAIL_MAX || !ADDRESS.test(address)) return INVALID_EMAIL;
  if (list.some((r, i) => i !== index && r.email.toLowerCase() === address)) return DUPLICATE_EMAIL;
  return null;
}

/** The list with recipient put at index, or added at the end when index is null. */
export function withRecipient(list: readonly Recipient[], index: number | null, recipient: Recipient): Recipient[] {
  const r = { email: normaliseEmail(recipient.email), babysitter: recipient.babysitter.trim() };
  if (index === null) return [...list, r];
  return list.map((old, i) => (i === index ? r : old));
}

/** The list without the recipient at index. */
export function withoutRecipient(list: readonly Recipient[], index: number): Recipient[] {
  return list.filter((_, i) => i !== index);
}

/**
 * The server's 400 text for showing under the field: without the "recipients[2]: " it names the
 * row by, and starting with a capital.
 */
export function serverProblem(error: string): string {
  const text = error.replace(/^recipients\[\d+\]:\s*/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Babysitter: Nan" or "No babysitter". */
export function recipientSummary(r: Recipient): string {
  return r.babysitter ? `Babysitter: ${r.babysitter}` : "No babysitter";
}

/** A row's accessible name: "nan@example.com, babysitter Nan" or "…, no babysitter". */
export function recipientLabel(r: Recipient): string {
  return `${r.email}, ${r.babysitter ? `babysitter ${r.babysitter}` : "no babysitter"}`;
}

/**
 * The last-send line, or null before the first roster email: "Last sent Fri 2 Oct, 6:03 pm to 2
 * people" ("to 1 person"), or "Last email failed Fri 2 Oct, 6:03 pm. Check the server log."
 */
export function lastSendText(last: LastSend | null, today: DateString): { text: string; failed: boolean } | null {
  if (!last) return null;
  const at = new Date(last.at);
  const when = `${formatDayOf(at, today)}, ${formatTime(at)}`;
  if (!last.ok) return { text: `Last email failed ${when}. Check the server log.`, failed: true };
  const people = last.recipients === 1 ? "1 person" : `${last.recipients} people`;
  return { text: `Last sent ${when} to ${people}`, failed: false };
}
