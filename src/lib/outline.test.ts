// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { activeOutlineIndex, extractDocumentOutline } from "./outline";

describe("document outline", () => {
  it("extracts heading text, hierarchy levels and document positions", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<h1>开始</h1><p>正文</p><h2>细节 <em>说明</em></h2><h3></h3>",
    });

    const outline = extractDocumentOutline(editor.state.doc);

    expect(outline.map(({ level, text }) => ({ level, text }))).toEqual([
      { level: 1, text: "开始" },
      { level: 2, text: "细节 说明" },
      { level: 3, text: "未命名标题" },
    ]);
    expect(outline[1].position).toBeGreaterThan(outline[0].position);
  });

  it("follows the nearest heading before the current selection", () => {
    const headings = [
      { level: 1 as const, text: "一", position: 0 },
      { level: 2 as const, text: "二", position: 12 },
      { level: 2 as const, text: "三", position: 30 },
    ];

    expect(activeOutlineIndex(headings, 1)).toBe(0);
    expect(activeOutlineIndex(headings, 18)).toBe(1);
    expect(activeOutlineIndex(headings, 30)).toBe(2);
  });
});
