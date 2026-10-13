import type { QuoteEntry } from "./types";

// Rotate through enabled entries once per calendar day in the viewer's local time.
// A full cycle visits every active entry before the sequence repeats.
export function dailyQuote(entries: QuoteEntry[] | undefined, date: Date = new Date()): QuoteEntry | null {
  const active = (entries ?? []).filter((item) => item.enabled && item.text?.trim());
  if (!active.length) return null;
  const utcDay = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return active[((utcDay % active.length) + active.length) % active.length];
}

export function enabledQuoteCount(entries: QuoteEntry[] | undefined): number {
  return (entries ?? []).filter((item) => item.enabled && item.text?.trim()).length;
}
