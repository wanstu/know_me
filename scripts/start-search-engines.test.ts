import assert from "node:assert/strict";
import {
  START_SEARCH_ENGINES,
  configuredStartSearchEngines,
  validSearchEngineURL,
  isStartSearchEngine,
  nextStartSearchEngine,
  startSearchURL
} from "../native-web/src/start-search-engines";

assert.deepEqual(START_SEARCH_ENGINES.map((entry) => entry.id), ["Bing", "Google", "DuckDuckGo", "Baidu", "Sogou"]);
assert.equal(nextStartSearchEngine("Bing"), "Google");
assert.equal(nextStartSearchEngine("Bing", -1), "Sogou");
assert.equal(nextStartSearchEngine("Sogou"), "Bing");
assert.equal(nextStartSearchEngine("Google", -1), "Bing");
assert.equal(isStartSearchEngine("DuckDuckGo"), true);
assert.equal(isStartSearchEngine("Unknown"), false);
for (const engine of START_SEARCH_ENGINES) {
  const url = new URL(startSearchURL(engine.id, "中文 与 space/?"));
  const parameter = engine.id === "Baidu" ? "wd" : engine.id === "Sogou" ? "query" : "q";
  assert.equal(url.searchParams.get(parameter), "中文 与 space/?", engine.id);
  assert.equal(url.protocol, "https:");
}
const customized = [
  { id: "custom", name: "内部搜索", url: "https://example.com/?term={query}", iconUrl: "" },
  { id: "Google", name: "Google", url: "https://www.google.com/search?q={query}", iconUrl: "" }
];
assert.deepEqual(configuredStartSearchEngines(customized).map((e) => e.id), ["custom", "Google"]);
assert.equal(nextStartSearchEngine("custom", -1, customized), "Google");
assert.equal(nextStartSearchEngine("Google", 1, customized), "custom");
assert.equal(isStartSearchEngine("Bing", customized), false);
assert.equal(new URL(startSearchURL("custom", "汉字 &?", customized)).searchParams.get("term"), "汉字 &?");
for (const bad of ["javascript:alert({query})", "http://example.com/?q={query}", "https://example.com/search", "https://example.com/?q={query}&x={query}"]) {
  assert.equal(validSearchEngineURL(bad), false, bad);
}
console.log("Start search engine tests passed");
