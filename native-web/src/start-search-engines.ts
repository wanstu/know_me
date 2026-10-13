export const START_SEARCH_ENGINES = [
  { id: "Bing", name: "Bing", short: "Bing", mark: "B" },
  { id: "Google", name: "Google", short: "Google", mark: "G" },
  { id: "DuckDuckGo", name: "DuckDuckGo", short: "DuckDuckGo", mark: "D" },
  { id: "Baidu", name: "百度", short: "百度", mark: "百" },
  { id: "Sogou", name: "搜狗", short: "搜狗", mark: "搜" }
] as const;

export type StartSearchEngine = (typeof START_SEARCH_ENGINES)[number]["id"];

export function isStartSearchEngine(value: unknown): value is StartSearchEngine {
  return typeof value === "string" && START_SEARCH_ENGINES.some((engine) => engine.id === value);
}

export function nextStartSearchEngine(current: StartSearchEngine, direction: 1 | -1 = 1): StartSearchEngine {
  const index = START_SEARCH_ENGINES.findIndex((engine) => engine.id === current);
  return START_SEARCH_ENGINES[(index + direction + START_SEARCH_ENGINES.length) % START_SEARCH_ENGINES.length].id;
}

export function startSearchURL(engine: StartSearchEngine, query: string): string {
  const encoded = encodeURIComponent(query.trim());
  switch (engine) {
    case "Google": return "https://www.google.com/search?q=" + encoded;
    case "DuckDuckGo": return "https://duckduckgo.com/?q=" + encoded;
    case "Baidu": return "https://www.baidu.com/s?wd=" + encoded;
    case "Sogou": return "https://www.sogou.com/web?query=" + encoded;
    case "Bing": return "https://www.bing.com/search?q=" + encoded;
  }
}
