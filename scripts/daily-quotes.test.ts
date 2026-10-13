import assert from "node:assert/strict";
import { dailyQuote, enabledQuoteCount } from "../native-web/src/daily-quotes";
import type { QuoteEntry } from "../native-web/src/types";

const quotes: QuoteEntry[] = [
  { id: "a", text: "One", author: "", enabled: true },
  { id: "b", text: "Two", author: "author", enabled: true },
  { id: "off", text: "Off", author: "", enabled: false },
  { id: "c", text: "Three", author: "", enabled: true }
];

const base = new Date(2026, 0, 1);
const day1 = dailyQuote(quotes, base);
assert.ok(day1);
assert.equal(enabledQuoteCount(quotes), 3);
assert.equal(dailyQuote(quotes, new Date(2026, 0, 1, 23, 59))?.id, day1.id);
const results = new Set(
  [1, 2, 3].map((day) => dailyQuote(quotes, new Date(2026, 0, day))?.id)
);
assert.deepEqual(results.size, 3, "a complete cycle must show each enabled quote once");
assert.equal(dailyQuote(quotes, new Date(2026, 0, 4))?.id, day1.id);
assert.equal(dailyQuote(quotes.filter((q) => q.id === "off"), base), null);
assert.equal(dailyQuote([]), null);
assert.equal(enabledQuoteCount([{ id: "empty", text: " ", author: "", enabled: true }]), 0);
console.log("Daily quote library tests passed");
