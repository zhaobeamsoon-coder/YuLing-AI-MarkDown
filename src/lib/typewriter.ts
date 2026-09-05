import type { EditorView } from "@tiptap/pm/view";

export function centerEditorSelection(view: EditorView): boolean {
  const scroll = view.dom.closest<HTMLElement>(".editor-scroll");
  if (!scroll) return false;
  const caret = view.coordsAtPos(view.state.selection.head);
  const viewport = scroll.getBoundingClientRect();
  const offset = caret.top - (viewport.top + viewport.height / 2);
  if (Math.abs(offset) < 2) return false;
  scroll.scrollBy({ top: offset, behavior: "smooth" });
  return true;
}
