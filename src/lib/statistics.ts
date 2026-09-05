export interface WritingStatistics {
  words: number;
  characters: number;
  lines: number;
  paragraphs: number;
  readingMinutes: number;
}

const cjkCharacter = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;
const nonCjkWord = /[\p{L}\p{N}]+(?:[.'’-][\p{L}\p{N}]+)*/gu;

export function countWritingStatistics(text: string): WritingStatistics {
  const characters = Array.from(text).filter((character) => !/\s/u.test(character)).length;
  const cjkWords = Array.from(text).filter((character) => cjkCharacter.test(character)).length;
  const withoutCjk = Array.from(text).map((character) => cjkCharacter.test(character) ? " " : character).join("");
  const otherWords = withoutCjk.match(nonCjkWord)?.length ?? 0;
  const words = cjkWords + otherWords;
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized ? normalized.split("\n").length : 0;
  const paragraphs = normalized.trim() ? normalized.trim().split(/\n\s*\n+/).length : 0;
  return { words, characters, lines, paragraphs, readingMinutes: words ? Math.max(1, Math.ceil(words / 300)) : 0 };
}

export function formatWritingStatistics(document: WritingStatistics, selection: WritingStatistics): string {
  const base = `${document.words} 字 · ${document.characters} 字符 · ${document.lines} 行 · ${document.paragraphs} 段 · 约 ${document.readingMinutes} 分钟`;
  return selection.characters ? `${base} · 已选 ${selection.words} 字 / ${selection.characters} 字符` : base;
}
