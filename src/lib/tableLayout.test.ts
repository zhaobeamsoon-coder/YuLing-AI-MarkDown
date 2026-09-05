import { describe, expect, it } from "vitest";
import { applyImageLayouts, applyTableLayouts, extractImageLayouts, extractTableLayouts, normalizeWorkspaceLayout, type TiptapNode } from "./tableLayout";

const document: TiptapNode = {
  type: "doc",
  content: [
    { type: "heading", content: [{ type: "text", text: "表格章节" }] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", attrs: { colspan: 1, colwidth: [180] } },
            { type: "tableHeader", attrs: { colspan: 1, colwidth: [260] } },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", attrs: { colspan: 1 } },
            { type: "tableCell", attrs: { colspan: 1 } },
          ],
        },
      ],
    },
  ],
};

describe("table layout persistence", () => {
  it("reapplies saved widths to every table row by stable section anchor", () => {
    const layouts = extractTableLayouts(document);
    const withoutWidths = structuredClone(document);
    for (const row of withoutWidths.content?.[1].content ?? []) {
      for (const cell of row.content ?? []) delete cell.attrs?.colwidth;
    }

    const restored = applyTableLayouts(withoutWidths, layouts);
    const rows = restored.content?.[1].content ?? [];
    expect(rows[0].content?.map((cell) => cell.attrs?.colwidth)).toEqual([[180], [260]]);
    expect(rows[1].content?.map((cell) => cell.attrs?.colwidth)).toEqual([[180], [260]]);
  });

  it("leaves unmatched tables on automatic width", () => {
    expect(applyTableLayouts(document, [{ anchor: "其他章节#0", widths: [400] }])).toEqual(document);
  });

  it("loads version one layouts with an empty image layout map", () => {
    expect(normalizeWorkspaceLayout({ version: 1, documents: { "正文.md": [] } })).toEqual({
      version: 2,
      documents: { "正文.md": [] },
      images: {},
    });
  });

  it("stores and reapplies image widths by source occurrence", () => {
    const images: TiptapNode = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "image", attrs: { markdownSrc: "assets/a.png", displayWidth: 320 } }] },
      { type: "paragraph", content: [{ type: "image", attrs: { markdownSrc: "assets/a.png" } }] },
    ] };
    const layouts = extractImageLayouts(images);
    expect(layouts).toEqual([{ key: "assets/a.png#0", width: 320 }]);
    const restored = applyImageLayouts(images, layouts);
    expect(restored.content?.[0].content?.[0].attrs?.displayWidth).toBe(320);
    expect(restored.content?.[1].content?.[0].attrs?.displayWidth).toBeUndefined();
  });
});
