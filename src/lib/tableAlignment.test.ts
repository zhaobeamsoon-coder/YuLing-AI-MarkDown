// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { CellSelection } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { alignSelectedTableColumns, currentTableAlignment } from "./tableAlignment";

describe("table column alignment", () => {
  it("does not inspect table cells while the cursor is in ordinary Markdown", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: "<p>普通段落必须能够直接打开</p>",
    });

    expect(currentTableAlignment(editor)).toBeNull();
    expect(alignSelectedTableColumns(editor, "center")).toBe(false);
    editor.destroy();
  });

  it("aligns the entire current column without changing saved widths", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [
            { type: "tableRow", content: [
              { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [180] }, content: [{ type: "paragraph" }] },
              { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [580] }, content: [{ type: "paragraph" }] },
            ] },
            { type: "tableRow", content: [
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [180] }, content: [{ type: "paragraph" }] },
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [580] }, content: [{ type: "paragraph" }] },
            ] },
          ],
        }],
      },
    });
    let firstCellPosition = -1;
    editor.state.doc.descendants((node, position) => {
      if (firstCellPosition < 0 && node.type.name === "tableHeader") firstCellPosition = position;
    });
    editor.commands.setTextSelection(firstCellPosition + 1);

    expect(alignSelectedTableColumns(editor, "center")).toBe(true);
    const table = editor.getJSON().content?.[0] as any;
    expect(table.content.map((row: any) => row.content[0].attrs)).toEqual([
      expect.objectContaining({ align: "center", colwidth: [180] }),
      expect.objectContaining({ align: "center", colwidth: [180] }),
    ]);
    expect(table.content.map((row: any) => row.content[1].attrs.colwidth)).toEqual([[580], [580]]);
    editor.destroy();
  });

  it("round-trips left, center, and right as standard GFM delimiters", () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, TableKit],
      content: "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| A | B | C |",
      contentType: "markdown",
    });
    const header = (editor.getJSON().content?.[0] as any).content[0];
    expect(header.content.map((cell: any) => cell.attrs.align)).toEqual(["left", "center", "right"]);
    expect(editor.getMarkdown()).toContain("| :--- | :---: | ---: |");
    editor.destroy();
  });

  it("aligns every column covered by a multi-cell selection", () => {
    const editor = new Editor({
      extensions: [StarterKit, TableKit],
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [
            { type: "tableRow", content: [
              { type: "tableHeader", content: [{ type: "paragraph" }] },
              { type: "tableHeader", content: [{ type: "paragraph" }] },
            ] },
            { type: "tableRow", content: [
              { type: "tableCell", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ] },
          ],
        }],
      },
    });
    const positions: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "tableHeader") positions.push(position);
    });
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, positions[0], positions[1])));

    expect(alignSelectedTableColumns(editor, "right")).toBe(true);
    const rows = (editor.getJSON().content?.[0] as any).content;
    expect(rows.flatMap((row: any) => row.content.map((cell: any) => cell.attrs.align))).toEqual([
      "right", "right", "right", "right",
    ]);
    editor.destroy();
  });
});
