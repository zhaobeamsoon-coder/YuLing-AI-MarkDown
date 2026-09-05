// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BlockMath, InlineMath } from "./math";
import { PageBreak } from "./pageBreak";
import { protectUnsupportedMarkdown, RawMarkdownBlock, RawMarkdownInline, RawMarkdownPreview } from "./rawMarkdown";
import { frontmatterEnvelope, joinFrontmatter } from "./markdown";

describe("visual editor Markdown round trip", () => {
  it("preserves page breaks and TeX commands", () => {
    const source = "行内 $E=mc^2$\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\n<!-- yuling:pagebreak -->\n\n# 第二页";
    const editor = new Editor({
      extensions: [StarterKit, Markdown, BlockMath, InlineMath, PageBreak, RawMarkdownBlock, RawMarkdownInline],
      content: source,
      contentType: "markdown",
    });

    const output = editor.getMarkdown();
    expect(output).toContain("$E=mc^2$");
    expect(output).toContain("\\int_0^1 x^2 dx = \\frac{1}{3}");
    expect(output).toContain("<!-- yuling:pagebreak -->");
    editor.destroy();
  });

  it("preserves unsupported Markdown and raw HTML byte-for-byte around editable text", () => {
    const protectedFragments = [
      '<details data-yuling="keep">\n<summary>原文</summary>\n<script>window.__yulingUnsafe = true</script>\n</details>',
      '<custom-tag data-x="1">行内原文</custom-tag>',
      '[^note]: 脚注 **原文**',
      ':::warning {#keep}\n自定义容器\n:::',
    ];
    const source = [
      "# 无损测试",
      "",
      protectedFragments[0],
      "",
      `普通正文和 ${protectedFragments[1]} 相邻。`,
      "",
      "脚注引用[^note]。",
      "",
      protectedFragments[2],
      "",
      protectedFragments[3],
    ].join("\n");
    const editor = new Editor({
      extensions: [StarterKit, Markdown, BlockMath, InlineMath, PageBreak, RawMarkdownBlock, RawMarkdownInline],
      content: protectUnsupportedMarkdown(source),
      contentType: "markdown",
    });

    const output = editor.getMarkdown();
    for (const fragment of protectedFragments) expect(output).toContain(fragment);
    editor.destroy();
  });

  it("keeps protected fragments stable across repeated visual round trips", () => {
    const source = "正文 <custom-x value=\"1\">原始内容</custom-x>。\n\n[^a]: 脚注原文";
    let output = source;
    let normalizedOnce = "";
    for (let index = 0; index < 10; index += 1) {
      const editor = new Editor({
        extensions: [StarterKit, Markdown, RawMarkdownBlock, RawMarkdownInline],
        content: protectUnsupportedMarkdown(output),
        contentType: "markdown",
      });
      output = editor.getMarkdown();
      editor.destroy();
      if (index === 0) normalizedOnce = output;
    }
    expect(output).toContain('<custom-x value="1">');
    expect(output).toContain("</custom-x>");
    expect(output).toContain("[^a]: 脚注原文");
    expect(output).not.toContain("yuling-internal-raw");
    expect(output).toBe(normalizedOnce);
  });

  it("renders footnotes and [toc] without changing their Markdown", () => {
    const source = "[toc]\n\n# 第一章\n\n正文[^a]。\n\n## 第二节\n\n[^a]: 脚注内容";
    const editor = new Editor({
      extensions: [StarterKit, Markdown, RawMarkdownBlock, RawMarkdownInline, RawMarkdownPreview],
      content: protectUnsupportedMarkdown(source),
      contentType: "markdown",
    });

    const toc = editor.view.dom.querySelector("[data-yuling-toc]");
    expect(toc?.textContent).toContain("第一章");
    expect(toc?.textContent).toContain("第二节");
    expect(editor.view.dom.querySelector(".yuling-footnote-reference")?.textContent).toBe("a");
    expect(editor.view.dom.querySelector(".yuling-footnote-definition")?.textContent).toContain("脚注内容");
    expect(editor.getMarkdown()).toContain("[toc]");
    expect(editor.getMarkdown()).toContain("正文[^a]");
    expect(editor.getMarkdown()).toContain("[^a]: 脚注内容");
    editor.destroy();
  });

  it("keeps the RC fixture stable across ten visual round trips", () => {
    const source = readFileSync("tests/fixtures/rc-complex-document.md", "utf8");
    let output = source;
    let normalized = "";
    for (let index = 0; index < 10; index += 1) {
      const envelope = frontmatterEnvelope(output);
      const editor = new Editor({
        extensions: [StarterKit, Markdown, BlockMath, InlineMath, PageBreak, RawMarkdownBlock, RawMarkdownInline],
        content: protectUnsupportedMarkdown(envelope.body),
        contentType: "markdown",
      });
      output = joinFrontmatter(envelope.frontmatter, editor.getMarkdown());
      editor.destroy();
      if (index === 0) normalized = output;
    }
    expect(output).toBe(normalized);
    expect(output).toContain('<custom-element value="1">不可丢失</custom-element>');
    expect(output).toContain("[^note]: 脚注内容需要无损保存。");
    expect(output).toContain("```mermaid");
  });
});
