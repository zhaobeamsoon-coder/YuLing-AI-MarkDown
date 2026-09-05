import { describe, expect, it } from "vitest";
import { countWritingStatistics, formatWritingStatistics } from "./statistics";

describe("writing statistics", () => {
  it("counts each CJK character and each Latin or numeric word", () => {
    expect(countWritingStatistics("你好 YuLing MD 2.0")).toEqual({ words: 5, characters: 13, lines: 1, paragraphs: 1, readingMinutes: 1 });
  });

  it("formats document and selection counts without inventing a selection", () => {
    const document = { words: 8, characters: 16, lines: 3, paragraphs: 2, readingMinutes: 1 };
    expect(formatWritingStatistics(document, { words: 0, characters: 0, lines: 0, paragraphs: 0, readingMinutes: 0 }))
      .toBe("8 字 · 16 字符 · 3 行 · 2 段 · 约 1 分钟");
    expect(formatWritingStatistics(document, { words: 3, characters: 5, lines: 1, paragraphs: 1, readingMinutes: 1 }))
      .toBe("8 字 · 16 字符 · 3 行 · 2 段 · 约 1 分钟 · 已选 3 字 / 5 字符");
  });

  it("counts lines and paragraphs independently", () => {
    expect(countWritingStatistics("第一段\n仍是第一段\n\n第二段")).toMatchObject({ lines: 4, paragraphs: 2 });
  });
});
