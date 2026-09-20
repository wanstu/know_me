import GithubSlugger from "github-slugger";

export type MarkdownImportMode = "plain" | "frontmatter";

export type ParsedMarkdownImport = {
  contentMd: string;
  title?: string;
  firstPublishedAt?: number;
};

export type TOCItem = {
  level: 2 | 3 | 4;
  text: string;
  id: string;
};

const frontMatterDelimiter = /^---\s*$/;

function normalizeLineEndings(value: string) {
  return value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function unquoteFrontMatterValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function splitFrontMatter(source: string) {
  const normalized = normalizeLineEndings(source);
  const lines = normalized.split("\n");
  if (!frontMatterDelimiter.test(lines[0] ?? "")) return null;

  let closeIndex = -1;
  for (let index = 1; index < lines.length; index++) {
    if (frontMatterDelimiter.test(lines[index]) || /^\.\.\.\s*$/.test(lines[index])) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex < 0) return null;

  return {
    headerLines: lines.slice(1, closeIndex),
    body: lines.slice(closeIndex + 1).join("\n").replace(/^\n+/, "")
  };
}

export function hasFrontMatter(source: string) {
  return splitFrontMatter(source) !== null;
}

export function stripFrontMatter(source: string) {
  return splitFrontMatter(source)?.body ?? normalizeLineEndings(source);
}

export function parseFrontMatterDate(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;

  let candidate = normalized;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(candidate)) {
    candidate = candidate.replace(/\s+/, "T");
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate += "T00:00:00";
  }

  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function parseMarkdownImport(source: string, mode: MarkdownImportMode): ParsedMarkdownImport {
  if (mode === "plain") {
    return { contentMd: normalizeLineEndings(source) };
  }

  const split = splitFrontMatter(source);
  if (!split) throw new Error("frontmatter_missing");

  let title: string | undefined;
  let firstPublishedAt: number | undefined;

  for (const rawLine of split.headerLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) throw new Error("frontmatter_invalid");

    const key = match[1].toLowerCase();
    const value = unquoteFrontMatterValue(match[2]);
    if (key === "title") {
      title = value.trim() || undefined;
    } else if (key === "date" && value.trim()) {
      const parsed = parseFrontMatterDate(value);
      if (parsed == null) throw new Error("frontmatter_date_invalid");
      firstPublishedAt = parsed;
    }
  }

  return { contentMd: split.body, title, firstPublishedAt };
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function plainHeadingText(value: string) {
  return decodeBasicEntities(value
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[\x60*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function comparableTitle(value: string) {
  return plainHeadingText(value).toLocaleLowerCase();
}

export function normalizeMarkdownForDisplay(source: string, documentTitle?: string) {
  const body = stripFrontMatter(source);
  if (!documentTitle) return body;

  const lines = body.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;

  const match = lines[index]?.match(/^\s*#\s+(.+?)\s*#*\s*$/);
  if (match && comparableTitle(match[1]) === comparableTitle(documentTitle)) {
    lines.splice(index, 1);
    while (index < lines.length && !lines[index].trim()) lines.splice(index, 1);
  }
  return lines.join("\n");
}

export function tableOfContents(source: string, documentTitle?: string): TOCItem[] {
  const markdown = normalizeMarkdownForDisplay(source, documentTitle);
  const slugger = new GithubSlugger();
  const result: TOCItem[] = [];
  let fenced = false;

  for (const line of markdown.split("\n")) {
    if (/^\s*\x60\x60\x60/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = line.match(/^\s*(##|###|####)\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const text = plainHeadingText(match[2]);
    if (!text) continue;
    result.push({
      level: match[1].length as 2 | 3 | 4,
      text,
      id: slugger.slug(text)
    });
  }

  return result;
}

export function markdownToText(source: string) {
  return stripFrontMatter(source)
    .replace(/\x60\x60\x60[\s\S]*?\x60\x60\x60/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\r\n]+\$/g, " ")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptFrom(source: string, documentTitle?: string) {
  const value = markdownToText(normalizeMarkdownForDisplay(source, documentTitle));
  return value.length > 180 ? value.slice(0, 177) + "..." : value;
}

export function looksLikeFrontMatterExcerpt(excerpt: string) {
  return /^\s*(title|date)\s*:/i.test(excerpt);
}
