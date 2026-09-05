import { Extension, type Editor } from "@tiptap/core";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { SpecialSelectionMode } from "./selectionPreferences";

export interface PersistentSelectionRange {
  from: number;
  to: number;
  decoration?: "inline" | "node";
}

export interface EditorSelectionSnapshot extends PersistentSelectionRange {
  anchor: number;
  head: number;
  text: string;
}

const persistentSelectionKey = new PluginKey<PersistentSelectionRange | null>("yulingPersistentSelection");

export const PersistentSelection = Extension.create({
  name: "yulingPersistentSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin<PersistentSelectionRange | null>({
        key: persistentSelectionKey,
        state: {
          init: () => null,
          apply(transaction, current) {
            const next = transaction.getMeta(persistentSelectionKey) as PersistentSelectionRange | null | undefined;
            if (next === null) return null;
            if (next) return next;
            if (transaction.docChanged) return null;
            return current;
          },
        },
        props: {
          decorations(state) {
            const range = persistentSelectionKey.getState(state);
            if (!range || range.from >= range.to || range.to > state.doc.content.size) return DecorationSet.empty;
            const decoration = range.decoration === "node"
              ? Decoration.node(range.from, range.to, { class: "yuling-persistent-selection" })
              : Decoration.inline(range.from, range.to, { class: "yuling-persistent-selection" });
            return DecorationSet.create(state.doc, [decoration]);
          },
        },
      }),
    ];
  },
});

export function applyPersistentSelection(editor: Editor, range: PersistentSelectionRange | null): void {
  editor.view.dispatch(editor.state.tr
    .setMeta(persistentSelectionKey, range)
    .setMeta("addToHistory", false));
}

export function shouldPublishNativeSelection(selection: Selection | null, editorDom: HTMLElement): boolean {
  return Boolean(selection && !selection.isCollapsed && selection.anchorNode && editorDom.contains(selection.anchorNode));
}

function leafSelectionText(node: { type: { name: string }; attrs?: Record<string, unknown> }): string {
  const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
  if (node.type.name === "yulingInlineMath") return `$${latex}$`;
  if (node.type.name === "yulingBlockMath") return `$$${latex}$$`;
  if (
    (node.type.name === "yulingRawMarkdownInline" || node.type.name === "yulingRawMarkdownBlock")
    && typeof node.attrs?.raw === "string"
  ) return node.attrs.raw;
  return "";
}

function selectedText(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, "\n", leafSelectionText);
}

function formulaSelection(editor: Editor, anchorNode: Node, focusNode: Node): EditorSelectionSnapshot | null {
  const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
  const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement;
  const anchorFormula = anchorElement?.closest<HTMLElement>(".yuling-math-inline, .yuling-math-block");
  const focusFormula = focusElement?.closest<HTMLElement>(".yuling-math-inline, .yuling-math-block");
  if (!anchorFormula || anchorFormula !== focusFormula) return null;

  let snapshot: EditorSelectionSnapshot | null = null;
  editor.state.doc.descendants((node, position) => {
    if (snapshot || editor.view.nodeDOM(position) !== anchorFormula) return;
    const text = leafSelectionText(node);
    if (text) snapshot = { from: position, to: position + node.nodeSize, anchor: position, head: position + node.nodeSize, text };
  });
  return snapshot;
}

interface RawAtom {
  element: HTMLElement;
  from: number;
  to: number;
  raw: string;
}

function rawAtomAt(editor: Editor, domNode: Node): RawAtom | null {
  const element = (domNode instanceof Element ? domNode : domNode.parentElement)
    ?.closest<HTMLElement>("[data-yuling-raw-markdown]");
  if (!element) return null;
  let atom: RawAtom | null = null;
  editor.state.doc.descendants((node, position) => {
    if (atom || editor.view.nodeDOM(position) !== element) return;
    if (node.type.name !== "yulingRawMarkdownInline" && node.type.name !== "yulingRawMarkdownBlock") return;
    atom = {
      element,
      from: position,
      to: position + node.nodeSize,
      raw: typeof node.attrs.raw === "string" ? node.attrs.raw : "",
    };
  });
  return atom;
}

function selectionIsForward(selection: Selection): boolean {
  if (selection.anchorNode === selection.focusNode) return selection.anchorOffset <= selection.focusOffset;
  if (!selection.anchorNode || !selection.focusNode) return true;
  const probe = document.createRange();
  probe.setStart(selection.anchorNode, selection.anchorOffset);
  probe.setEnd(selection.focusNode, selection.focusOffset);
  return !probe.collapsed;
}

function rawSelection(
  editor: Editor,
  selection: Selection,
  anchorNode: Node,
  focusNode: Node,
  mode: SpecialSelectionMode,
): EditorSelectionSnapshot | null {
  const anchorAtom = rawAtomAt(editor, anchorNode);
  const focusAtom = rawAtomAt(editor, focusNode);
  if (!anchorAtom && !focusAtom) return null;
  const forward = selectionIsForward(selection);
  const anchor = anchorAtom
    ? (forward ? anchorAtom.from : anchorAtom.to)
    : editor.view.posAtDOM(anchorNode, selection.anchorOffset);
  const head = focusAtom
    ? (forward ? focusAtom.to : focusAtom.from)
    : editor.view.posAtDOM(focusNode, selection.focusOffset);
  const from = Math.min(anchor, head);
  const to = Math.max(anchor, head);
  const sameAtom = Boolean(anchorAtom && focusAtom && anchorAtom.element === focusAtom.element);
  const text = mode === "visible" ? selection.toString() : selectedText(editor, from, to);
  if (!text.trim()) return null;
  return sameAtom
    ? { from, to, anchor, head, text, decoration: "node" }
    : { from, to, anchor, head, text };
}

function selectionIntersectsRaw(editor: Editor, selection: Selection): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  return Array.from(editor.view.dom.querySelectorAll("[data-yuling-raw-markdown]"))
    .some((element) => range.intersectsNode(element));
}

export function readEditorSelection(
  editor: Editor,
  mode: SpecialSelectionMode = "visible",
): EditorSelectionSnapshot | null {
  const nativeSelection = window.getSelection();
  const anchorNode = nativeSelection?.anchorNode;
  const focusNode = nativeSelection?.focusNode;
  if (
    nativeSelection &&
    !nativeSelection.isCollapsed &&
    anchorNode &&
    focusNode &&
    editor.view.dom.contains(anchorNode) &&
    editor.view.dom.contains(focusNode)
  ) {
    const selectedFormula = formulaSelection(editor, anchorNode, focusNode);
    if (selectedFormula) return selectedFormula;
    try {
      const selectedRaw = rawSelection(editor, nativeSelection, anchorNode, focusNode, mode);
      if (selectedRaw) return selectedRaw;
      const anchor = editor.view.posAtDOM(anchorNode, nativeSelection.anchorOffset);
      const head = editor.view.posAtDOM(focusNode, nativeSelection.focusOffset);
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      const text = mode === "visible" && selectionIntersectsRaw(editor, nativeSelection)
        ? nativeSelection.toString()
        : selectedText(editor, from, to);
      if (text.trim()) return { from, to, anchor, head, text };
    } catch {
      // WebKit may invalidate a DOM range while ProseMirror is reconciling it.
    }
  }

  const selection = editor.state.selection;
  const { from, to } = selection;
  const text = from === to ? "" : selectedText(editor, from, to);
  if (!text.trim()) return null;
  const snapshot: EditorSelectionSnapshot = {
    from,
    to,
    anchor: "anchor" in selection ? selection.anchor : from,
    head: "head" in selection ? selection.head : to,
    text,
  };
  if (selection instanceof NodeSelection
    && (selection.node.type.name === "yulingRawMarkdownInline" || selection.node.type.name === "yulingRawMarkdownBlock")) {
    snapshot.decoration = "node";
  }
  return snapshot;
}

export function isPrimarySelectionButton(button: number): boolean {
  return button === 0;
}

export function isSelectionSafeTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return Boolean(element?.closest(".yuling-prose, .editor-toolbar, .selection-popover, .ai-panel"));
}
