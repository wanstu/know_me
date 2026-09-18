import { getBuiltinQuotes, randomHomeQuote } from "../lib/home/quotes";

const quotes = getBuiltinQuotes();
if (quotes.length < 20) throw new Error("expected at least 20 builtin quotes");
if (new Set(quotes.map((item) => item.text)).size !== quotes.length) throw new Error("duplicate builtin quotes");
const custom = randomHomeQuote("自定义短句", "自定义");
if (!custom.text || !custom.author) throw new Error("random quote returned empty value");

console.log("quotes smoke: PASS");
console.log("builtin=" + quotes.length);
