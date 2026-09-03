import type { Ticket } from "./types";

// Senders used by the public /api/demo samples. These addresses are
// deliberately fake, so any ticket from one of them is a demo row, not real
// support work. The dashboard badges these rows so a buyer evaluating the
// product never mistakes a demo resolution for a real one. Keep in sync with
// SAMPLES in app/api/demo/route.ts. The @b.com variants come from an older
// demo version (and whatever writes hourly demo-shaped rows, see README).
export const DEMO_SENDERS: ReadonlySet<string> = new Set([
  "sam@buyer.com",
  "jo@buyer.com",
  "al@buyer.com",
  "mia@buyer.com",
  "sam@b.com",
  "jo@b.com",
  "al@b.com",
  "mia@b.com",
]);

// True for demo rows: explicitly tagged (source === "demo", once the
// 002_add_source migration has been applied) or from a known demo sender
// (covers every demo row ever written, migration or not).
export function isDemoTicket(t: Pick<Ticket, "sender"> & { source?: string | null }): boolean {
  if (t.source === "demo") return true;
  return DEMO_SENDERS.has(t.sender);
}

// PostgREST `not ... in (...)` filter fragment for hiding demo rows.
// Values are unquoted: PostgREST treats double quotes as identifiers,
// which would silently match nothing. None of these addresses contain
// commas, parentheses, or whitespace, so bare values are correct.
export function demoExclusionFilter(): string {
  return `(${[...DEMO_SENDERS].join(",")})`;
}
