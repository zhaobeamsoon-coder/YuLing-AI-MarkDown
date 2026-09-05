import type { Editor } from "@tiptap/core";
import { CellSelection, selectionCell, TableMap } from "@tiptap/pm/tables";

export type TableAlignment = "left" | "center" | "right";

export function currentTableAlignment(editor: Editor): TableAlignment | null {
  if (!editor.isActive("table")) return null;
  const $cell = selectionCell(editor.state);
  const alignment = $cell?.nodeAfter?.attrs.align;
  return alignment === "left" || alignment === "center" || alignment === "right" ? alignment : null;
}

export function alignSelectedTableColumns(editor: Editor, alignment: TableAlignment): boolean {
  if (!editor.isActive("table")) return false;
  const { state, view } = editor;
  const $cell = selectionCell(state);
  if (!$cell) return false;

  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);
  const map = TableMap.get(table);
  let left = map.colCount($cell.pos - tableStart);
  let right = left + $cell.nodeAfter!.attrs.colspan;

  if (state.selection instanceof CellSelection) {
    const rectangle = map.rectBetween(
      state.selection.$anchorCell.pos - tableStart,
      state.selection.$headCell.pos - tableStart,
    );
    left = rectangle.left;
    right = rectangle.right;
  }

  const positions = new Set<number>();
  for (let row = 0; row < map.height; row += 1) {
    for (let column = left; column < right; column += 1) {
      positions.add(map.map[row * map.width + column]);
    }
  }

  const transaction = state.tr;
  positions.forEach((relativePosition) => {
    const cell = table.nodeAt(relativePosition);
    if (!cell || cell.attrs.align === alignment) return;
    transaction.setNodeMarkup(tableStart + relativePosition, null, { ...cell.attrs, align: alignment });
  });
  if (!transaction.docChanged) return true;
  view.dispatch(transaction);
  return true;
}
