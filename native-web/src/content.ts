export type ContentStats = {
  cjkCharacters: number;
  latinWords: number;
  totalCharacters: number;
  readingMinutes: number;
};

function plainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~|]/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentStats(markdown: string): ContentStats {
  const text = plainText(markdown);
  const cjkCharacters = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+(?:[\'’-][A-Za-z0-9]+)*/g) ?? []).length;
  const totalCharacters = Array.from(text.replace(/\s/g, "")).length;
  const minutes = cjkCharacters / 400 + latinWords / 200;
  return {
    cjkCharacters,
    latinWords,
    totalCharacters,
    readingMinutes: Math.max(1, Math.ceil(minutes))
  };
}
