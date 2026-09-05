import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  applyPersistentSelection,
  isPrimarySelectionButton,
  isSelectionSafeTarget,
  readEditorSelection,
  shouldPublishNativeSelection,
  type EditorSelectionSnapshot,
} from "./persistentSelection";
import { isTableResizeBoundary } from "./tableResize";
import {
  idleSelectionLifecycle,
  reduceSelectionLifecycle,
  shouldPublishSelectionChange,
} from "./selectionLifecycle";
import type { SpecialSelectionMode } from "./selectionPreferences";

export interface SelectionPopover {
  left: number;
  top: number;
}

export function shouldStartPointerSelection(event: MouseEvent | PointerEvent): boolean {
  return isPrimarySelectionButton(event.button)
    && !isTableResizeBoundary(event.target, event.clientX);
}

export function usePersistentEditorSelection(
  editorRef: MutableRefObject<Editor | null>,
  specialSelectionMode: SpecialSelectionMode,
  onSelection: (text: string) => void,
  setSelectionPopover: Dispatch<SetStateAction<SelectionPopover | null>>,
) {
  const pointerSelecting = useRef(false);
  const selectionLifecycle = useRef(idleSelectionLifecycle);
  const suppressSelectionUpdate = useRef(false);
  const selectionSnapshot = useRef<EditorSelectionSnapshot | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const selectionFrame = useRef<number | null>(null);
  const onSelectionRef = useRef(onSelection);
  onSelectionRef.current = onSelection;

  const positionPopover = (view: Editor["view"], snapshot: EditorSelectionSnapshot) => {
    const caret = view.coordsAtPos(snapshot.head);
    const scrollContainer = view.dom.closest(".editor-scroll");
    const viewport = scrollContainer?.getBoundingClientRect();
    if (viewport && (caret.bottom < viewport.top || caret.top > viewport.bottom)) {
      setSelectionPopover(null);
      return;
    }
    const top = caret.bottom + 46 > window.innerHeight ? caret.top - 42 : caret.bottom + 8;
    setSelectionPopover({
      left: Math.min(Math.max(caret.left, 74), window.innerWidth - 74),
      top: Math.max(8, top),
    });
  };

  const clearPublishedSelection = (currentEditor: Editor, collapse: boolean) => {
    const snapshot = selectionSnapshot.current;
    pointerSelecting.current = false;
    selectionSnapshot.current = null;
    setSelectionPopover(null);
    applyPersistentSelection(currentEditor, null);
    onSelectionRef.current("");
    if (!collapse || !snapshot) return;
    suppressSelectionUpdate.current = true;
    currentEditor.commands.setTextSelection(Math.min(snapshot.head, currentEditor.state.doc.content.size));
    suppressSelectionUpdate.current = false;
  };

  const publishSelection = (currentEditor: Editor, preserveOnEmpty = false) => {
    const snapshot = readEditorSelection(currentEditor, specialSelectionMode);
    if (!snapshot) {
      const previous = selectionSnapshot.current;
      if (preserveOnEmpty && previous) {
        applyPersistentSelection(currentEditor, { from: previous.from, to: previous.to });
        positionPopover(currentEditor.view, previous);
        return;
      }
      clearPublishedSelection(currentEditor, false);
      return;
    }
    const previous = selectionSnapshot.current;
    selectionSnapshot.current = snapshot;
    applyPersistentSelection(currentEditor, { from: snapshot.from, to: snapshot.to });
    if (!previous || previous.from !== snapshot.from || previous.to !== snapshot.to || previous.text !== snapshot.text) {
      onSelectionRef.current(snapshot.text);
    }
    positionPopover(currentEditor.view, snapshot);
  };

  const handleContextMenu = (view: Editor["view"]) => {
    selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, { type: "context-menu" });
    const snapshot = selectionSnapshot.current;
    if (!snapshot || snapshot.to > view.state.doc.content.size) return false;
    suppressSelectionUpdate.current = true;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, snapshot.anchor, snapshot.head)));
    suppressSelectionUpdate.current = false;
    window.requestAnimationFrame(() => positionPopover(view, snapshot));
    return false;
  };

  const handleBlur = (view: Editor["view"]) => {
    selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, { type: "blur" });
    const snapshot = selectionSnapshot.current;
    if (snapshot && snapshot.to <= view.state.doc.content.size) {
      window.requestAnimationFrame(() => {
        const currentEditor = editorRef.current;
        if (selectionSnapshot.current === snapshot && currentEditor && !currentEditor.isDestroyed) {
          applyPersistentSelection(currentEditor, { from: snapshot.from, to: snapshot.to });
        }
      });
    }
    return false;
  };

  const clearSelectionOnEditorUpdate = () => {
    if (!selectionSnapshot.current) return;
    selectionSnapshot.current = null;
    setSelectionPopover(null);
    onSelectionRef.current("");
  };

  const handleSelectionUpdate = (currentEditor: Editor) => {
    if (!pointerSelecting.current && !suppressSelectionUpdate.current) publishSelection(currentEditor);
  };

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    const editorDom = editor.view.dom;
    const scheduleStablePublish = (preserveOnEmpty = false) => {
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
      selectionFrame.current = window.requestAnimationFrame(() => {
        selectionFrame.current = window.requestAnimationFrame(() => {
          selectionFrame.current = null;
          if (!editor.isDestroyed) publishSelection(editor, preserveOnEmpty);
        });
      });
    };
    const startPointerSelection = (event: MouseEvent | PointerEvent) => {
      if (!shouldStartPointerSelection(event)) return;
      selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, { type: "primary-down" });
      pointerSelecting.current = true;
      setSelectionPopover(null);
    };
    const finishPointerSelection = (preserveOnEmpty = false) => {
      if (!pointerSelecting.current) return;
      selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, {
        type: preserveOnEmpty ? "pointer-cancel" : "pointer-up",
      });
      pointerSelecting.current = false;
      scheduleStablePublish(preserveOnEmpty || selectionLifecycle.current.preserveOnRelease);
    };
    const publishNativeSelection = () => {
      const usable = shouldPublishNativeSelection(window.getSelection(), editorDom);
      if (shouldPublishSelectionChange(selectionLifecycle.current, suppressSelectionUpdate.current, usable)) scheduleStablePublish();
    };
    const clearFromOutside = (event: PointerEvent) => {
      if (!selectionSnapshot.current || isSelectionSafeTarget(event.target)) return;
      clearPublishedSelection(editor, true);
    };
    const clearFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectionSnapshot.current) clearPublishedSelection(editor, true);
    };
    const supportsPointerEvents = typeof window.PointerEvent !== "undefined";
    const finish = () => finishPointerSelection(false);
    const cancel = () => finishPointerSelection(true);
    if (supportsPointerEvents) {
      editorDom.addEventListener("pointerdown", startPointerSelection, true);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancel);
    } else {
      editorDom.addEventListener("mousedown", startPointerSelection, true);
      window.addEventListener("mouseup", finish);
    }
    document.addEventListener("selectionchange", publishNativeSelection);
    window.addEventListener("pointerdown", clearFromOutside, true);
    window.addEventListener("keydown", clearFromEscape);
    return () => {
      if (supportsPointerEvents) {
        editorDom.removeEventListener("pointerdown", startPointerSelection, true);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", cancel);
      } else {
        editorDom.removeEventListener("mousedown", startPointerSelection, true);
        window.removeEventListener("mouseup", finish);
      }
      document.removeEventListener("selectionchange", publishNativeSelection);
      window.removeEventListener("pointerdown", clearFromOutside, true);
      window.removeEventListener("keydown", clearFromEscape);
      if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
      if (selectionFrame.current !== null) window.cancelAnimationFrame(selectionFrame.current);
    };
  }, [editorRef, specialSelectionMode]);

  const handleScroll = () => {
    const editor = editorRef.current;
    if (!editor || !selectionSnapshot.current) return;
    if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (selectionSnapshot.current) positionPopover(editor.view, selectionSnapshot.current);
    });
  };

  return {
    clearPublishedSelection, clearSelectionOnEditorUpdate, handleBlur, handleContextMenu,
    handleScroll, handleSelectionUpdate, selectionSnapshot, suppressSelectionUpdate,
  };
}
