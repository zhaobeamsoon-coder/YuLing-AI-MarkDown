// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  AdjacentTableResizing,
  TABLE_CELL_MIN_WIDTH,
  TABLE_RESIZE_HANDLE_WIDTH,
  redistributeAdjacentWidths,
} from "./tableResize";

describe("adjacent table column resizing", () => {
  it("shrinks the left column and gives the released width to its neighbor", () => {
    expect(redistributeAdjacentWidths([380, 380], 0, -292)).toEqual([88, 672]);
  });

  it("preserves the table width and clamps both columns to the readable minimum", () => {
    const widths = redistributeAdjacentWidths([240, 260, 300], 1, 400);
    expect(widths).toEqual([240, 472, 88]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(800);
    expect(TABLE_CELL_MIN_WIDTH).toBe(88);
    expect(TABLE_RESIZE_HANDLE_WIDTH).toBe(8);
  });

  it("writes both rendered column widths through the production TipTap plugin", () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        AdjacentTableResizing,
        TableKit.configure({
          table: {
            resizable: true,
            cellMinWidth: TABLE_CELL_MIN_WIDTH,
            handleWidth: TABLE_RESIZE_HANDLE_WIDTH,
          },
        }),
      ],
      content: {
        type: "doc",
        content: [{
          type: "table",
          content: [{
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [380] }, content: [{ type: "paragraph" }] },
              { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [380] }, content: [{ type: "paragraph" }] },
            ],
          }],
        }],
      },
    });
    document.body.appendChild(editor.view.dom);

    let firstCellPosition = -1;
    editor.state.doc.descendants((node, position) => {
      if (firstCellPosition < 0 && node.type.name === "tableCell") firstCellPosition = position;
    });
    editor.view.dispatch(editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: firstCellPosition }));

    const columns = editor.view.dom.querySelectorAll("col");
    expect(columns).toHaveLength(2);
    columns.forEach((column) => {
      column.getBoundingClientRect = () => ({
        width: 380,
        height: 100,
        top: 0,
        right: 380,
        bottom: 100,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
    });
    const firstCell = editor.view.dom.querySelector("td")!;
    firstCell.getBoundingClientRect = () => ({
      width: 380,
      height: 100,
      top: 0,
      right: 380,
      bottom: 100,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    firstCell.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 380,
    }));
    window.dispatchEvent(new MouseEvent("mouseup", { clientX: 88 }));

    const json = editor.getJSON() as {
      content?: Array<{ content?: Array<{ content?: Array<{ attrs?: { colwidth?: number[] } }> }> }>;
    };
    const cells = json.content?.[0]?.content?.[0]?.content ?? [];
    expect(cells.map((cell) => cell.attrs?.colwidth)).toEqual([[88], [672]]);
    editor.destroy();
  });

  it("does not consume paragraph selection when a table handle state is stale", () => {
    const editor = new Editor({
      extensions: [StarterKit, AdjacentTableResizing, TableKit.configure({ table: { resizable: true } })],
      content: {
        type: "doc",
        content: [
          { type: "table", content: [{ type: "tableRow", content: [
            { type: "tableCell", content: [{ type: "paragraph" }] },
            { type: "tableCell", content: [{ type: "paragraph" }] },
          ] }] },
          { type: "paragraph", content: [{ type: "text", text: "这里应该能够正常开始划词" }] },
        ],
      },
    });
    document.body.appendChild(editor.view.dom);
    let firstCellPosition = -1;
    editor.state.doc.descendants((node, position) => {
      if (firstCellPosition < 0 && node.type.name === "tableCell") firstCellPosition = position;
    });
    editor.view.dispatch(editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: firstCellPosition }));

    const paragraph = Array.from(editor.view.dom.querySelectorAll("p")).at(-1)!;
    document.elementFromPoint = () => paragraph;
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect = () => paragraph.getBoundingClientRect();
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: 30,
    });
    paragraph.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(columnResizingPluginKey.getState(editor.state)?.activeHandle).toBe(-1);
    editor.destroy();
  });
});
