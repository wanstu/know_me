import assert from "node:assert/strict";
import {
  START_SEARCH_ENGINES,
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
console.log("Start search engine tests passed");
