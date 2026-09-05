import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { columnResizingPluginKey, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

export const TABLE_CELL_MIN_WIDTH = 88;
export const TABLE_RESIZE_HANDLE_WIDTH = 8;

export function redistributeAdjacentWidths(
  widths: number[],
  leftColumn: number,
  delta: number,
  minimum = TABLE_CELL_MIN_WIDTH,
): number[] {
  if (leftColumn < 0 || leftColumn + 1 >= widths.length) return widths.slice();
  const next = widths.slice();
  const pairWidth = widths[leftColumn] + widths[leftColumn + 1];
  const leftWidth = Math.min(Math.max(widths[leftColumn] + delta, minimum), pairWidth - minimum);
  next[leftColumn] = leftWidth;
  next[leftColumn + 1] = pairWidth - leftWidth;
  return next;
}

function tableElementAt(view: EditorView, tableStart: number): HTMLTableElement | null {
  let element = view.domAtPos(tableStart).node as HTMLElement | null;
  while (element && element.nodeName !== "TABLE") element = element.parentElement;
  return element as HTMLTableElement | null;
}

function renderedColumnWidths(table: HTMLTableElement, columnCount: number): number[] | null {
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col")).slice(0, columnCount);
  if (columns.length !== columnCount) return null;
  const widths = columns.map((column) => {
    const rendered = column.getBoundingClientRect().width;
    return rendered || Number.parseFloat((column as HTMLElement).style.width);
  });
  return widths.every((width) => Number.isFinite(width) && width > 0) ? widths : null;
}

function setColumnWidth(
  transaction: Transaction,
  table: ProseMirrorNode,
  tableStart: number,
  map: TableMap,
  column: number,
  width: number,
) {
  for (let row = 0; row < map.height; row += 1) {
    const mapIndex = row * map.width + column;
    if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;
    const relativePosition = map.map[mapIndex];
    const cell = table.nodeAt(relativePosition);
    if (!cell) continue;
    const widthIndex = cell.attrs.colspan === 1 ? 0 : column - map.colCount(relativePosition);
    const colwidth = cell.attrs.colwidth ? cell.attrs.colwidth.slice() : Array(cell.attrs.colspan).fill(0);
    if (colwidth[widthIndex] === width) continue;
    colwidth[widthIndex] = Math.round(width);
    transaction.setNodeMarkup(tableStart + relativePosition, null, { ...cell.attrs, colwidth });
  }
}

function previewWidths(table: HTMLTableElement, widths: number[]) {
  const columns = Array.from(table.querySelectorAll(":scope > colgroup > col"));
  widths.forEach((width, index) => {
    (columns[index] as HTMLElement | undefined)?.style.setProperty("width", `${width}px`);
  });
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`;
  table.style.minWidth = "";
}

export function isTableResizeBoundary(target: EventTarget | null, clientX: number): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const cell = element?.closest("td, th");
  if (!cell) return false;
  const bounds = cell.getBoundingClientRect();
  return Math.abs(clientX - bounds.left) <= TABLE_RESIZE_HANDLE_WIDTH
    || Math.abs(bounds.right - clientX) <= TABLE_RESIZE_HANDLE_WIDTH;
}

export const AdjacentTableResizing = Extension.create({
  name: "adjacentTableResizing",
  priority: 110,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              if (event.button !== 0 || !view.editable) return false;
              const resizeState = columnResizingPluginKey.getState(view.state);
              if (!resizeState || resizeState.activeHandle < 0 || resizeState.dragging) return false;
              if (!isTableResizeBoundary(event.target, event.clientX)) {
                view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: -1 }));
                return false;
              }

              const $cell = view.state.doc.resolve(resizeState.activeHandle);
              const table = $cell.node(-1);
              const map = TableMap.get(table);
              const tableStart = $cell.start(-1);
              const leftColumn = map.colCount($cell.pos - tableStart) + $cell.nodeAfter!.attrs.colspan - 1;
              if (leftColumn >= map.width - 1) return false;

              const tableElement = tableElementAt(view, tableStart);
              const originalWidths = tableElement && renderedColumnWidths(tableElement, map.width);
              if (!tableElement || !originalWidths) return false;

              const startX = event.clientX;
              const ownerWindow = view.dom.ownerDocument.defaultView ?? window;
              view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, {
                setDragging: { startX, startWidth: originalWidths[leftColumn] },
              }));

              const widthsAt = (clientX: number) => redistributeAdjacentWidths(
                originalWidths,
                leftColumn,
                clientX - startX,
              );
              const move = (moveEvent: MouseEvent) => {
                if (moveEvent.buttons === 0) {
                  finish(moveEvent);
                  return;
                }
                previewWidths(tableElement, widthsAt(moveEvent.clientX));
              };
              const finish = (finishEvent: MouseEvent) => {
                ownerWindow.removeEventListener("mousemove", move);
                ownerWindow.removeEventListener("mouseup", finish);
                const finalWidths = widthsAt(finishEvent.clientX);
                const transaction = view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null });
                finalWidths.forEach((width, column) => {
                  setColumnWidth(transaction, table, tableStart, map, column, width);
                });
                view.dispatch(transaction);
              };

              previewWidths(tableElement, originalWidths);
              ownerWindow.addEventListener("mousemove", move);
              ownerWindow.addEventListener("mouseup", finish);
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
