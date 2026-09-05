// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript } from "./extendedMarks";

describe("extended Markdown marks", () => {
  it("parses, displays and saves highlight, subscript and superscript syntax", () => {
    const source = "这是 ==重点==，H~2~O 与 x^2^。";
    const editor = new Editor({
      extensions: [StarterKit, Markdown, MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript],
      content: source,
      contentType: "markdown",
    });

    expect(editor.getHTML()).toContain("<mark>重点</mark>");
    expect(editor.getHTML()).toContain("<sub>2</sub>");
    expect(editor.getHTML()).toContain("<sup>2</sup>");
    expect(editor.getMarkdown()).toContain("==重点==");
    expect(editor.getMarkdown()).toContain("H~2~O");
    expect(editor.getMarkdown()).toContain("x^2^");
    editor.destroy();
  });

  it("does not consume GFM strikethrough as subscript", () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, MarkdownSubscript],
      content: "~~删除~~",
      contentType: "markdown",
    });
    expect(editor.getHTML()).toContain("<s>删除</s>");
    expect(editor.getHTML()).not.toContain("<sub>");
    editor.destroy();
  });
});
