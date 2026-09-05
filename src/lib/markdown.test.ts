import { describe, expect, it } from "vitest";
import { frontmatterEnvelope, isLocalEditorEcho, joinFrontmatter, markdownToSafeHtml } from "./markdown";
import { extractTableLayouts } from "./tableLayout";

describe("markdown safety", () => {
  it("preserves frontmatter outside the visual editor", () => {
    const input = "---\ntitle: Demo\n---\n# Body";
    const envelope = frontmatterEnvelope(input);
    expect(joinFrontmatter(envelope.frontmatter, envelope.body)).toBe(input);
  });

  it("removes executable html from preview", async () => {
    const html = await markdownToSafeHtml("# Safe\n<script>alert(1)</script>");
    expect(html).toContain(">Safe</h1>");
    expect(html).not.toContain("<script>");
  });

  it("turns the portable page-break comment into a safe pagination node", async () => {
    const html = await markdownToSafeHtml("第一页\n\n<!-- yuling:pagebreak -->\n\n# 第二页\n\n<!-- yuling:pagebreak -->\n\n第三页");
    expect(html.match(/class="yuling-page-break"/g)).toHaveLength(2);
    expect(html).not.toContain("yuling:pagebreak");
  });

  it("renders trusted KaTeX markup after removing unsafe source HTML", async () => {
    const html = await markdownToSafeHtml("行内 $E=mc^2$。\n\n$$\n\\frac{1}{3}\n$$\n\n<script>alert(1)</script>");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain("mfrac");
    expect(html).not.toContain("<script>");
  });

  it("renders [toc] as linked headings for export", async () => {
    const html = await markdownToSafeHtml("[toc]\n\n# 第一章\n\n## 细节\n\n# 第一章");
    expect(html).toContain("<nav");
    expect(html).toContain('href="#user-content-第一章"');
    expect(html).toContain('id="user-content-第一章"');
    expect(html).toContain('id="user-content-第一章-2"');
    expect(html).not.toContain("[toc]");
  });

  it("distinguishes a local editor echo from an external document update", () => {
    expect(isLocalEditorEcho("正在拖选的正文", "正在拖选的正文")).toBe(true);
    expect(isLocalEditorEcho("磁盘上的新正文", "编辑器中的正文")).toBe(false);
    expect(isLocalEditorEcho("初次载入", null)).toBe(false);
  });
});

describe("table layout", () => {
  it("anchors widths to heading and table order", () => {
    const layouts = extractTableLayouts({
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "数据" }] },
        {
          type: "table",
          content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colwidth: [180] } }] }],
        },
      ],
    });
    expect(layouts).toEqual([{ anchor: "数据#0", widths: [180] }]);
  });
});
