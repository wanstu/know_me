import type { SearchEngineConfig } from "./types";

export const START_SEARCH_ENGINES: SearchEngineConfig[] = [
  { id: "Bing", name: "Bing", url: "https://www.bing.com/search?q={query}", iconUrl: "https://www.bing.com/favicon.ico" },
  { id: "Google", name: "Google", url: "https://www.google.com/search?q={query}", iconUrl: "https://www.google.com/favicon.ico" },
  { id: "DuckDuckGo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q={query}", iconUrl: "https://duckduckgo.com/favicon.ico" },
  { id: "Baidu", name: "百度", url: "https://www.baidu.com/s?wd={query}", iconUrl: "https://www.baidu.com/favicon.ico" },
  { id: "Sogou", name: "搜狗", url: "https://www.sogou.com/web?query={query}", iconUrl: "https://www.sogou.com/favicon.ico" }
];
export type StartSearchEngine = string;

export function validSearchEngineURL(value: string): boolean {
  if ((value.match(/\{query\}/g) ?? []).length !== 1) return false;
  try {
    const url = new URL(value.replace("{query}", "searchterm"));
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export function configuredStartSearchEngines(values?: SearchEngineConfig[]): SearchEngineConfig[] {
  if (!Array.isArray(values) || !values.length) return START_SEARCH_ENGINES;
  const seen = new Set<string>();
  const entries = values.filter((item) => {
    if (!item || !/^[a-z0-9_-]{1,80}$/i.test(item.id) || !item.name?.trim() ||
      seen.has(item.id) || !validSearchEngineURL(item.url)) return false;
    seen.add(item.id);
    return true;
  }).slice(0,12);
  return entries.length ? entries : START_SEARCH_ENGINES;
}

export function isStartSearchEngine(value: unknown, engines: SearchEngineConfig[] = START_SEARCH_ENGINES): value is string {
  return typeof value === "string" && engines.some((engine) => engine.id === value);
}

export function nextStartSearchEngine(current: string, direction: 1 | -1 = 1, engines: SearchEngineConfig[] = START_SEARCH_ENGINES): string {
  if (!engines.length) return "Bing";
  const index = engines.findIndex((engine) => engine.id === current);
  return engines[(index + direction + engines.length) % engines.length].id;
}

export function startSearchURL(engine: string, query: string, engines: SearchEngineConfig[] = START_SEARCH_ENGINES): string {
  const selected = engines.find((item) => item.id === engine) ?? engines[0] ?? START_SEARCH_ENGINES[0];
  return selected.url.replace("{query}", encodeURIComponent(query.trim()));
}
