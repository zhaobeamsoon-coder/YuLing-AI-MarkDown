import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { getMarkRange, type Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { applyImageLayouts, applyTableLayouts, type ImageLayout, type TableLayout, type TiptapNode } from "../lib/tableLayout";
import { frontmatterEnvelope, isLocalEditorEcho, joinFrontmatter } from "../lib/markdown";
import { BlockMath, InlineMath } from "../lib/math";
import { PageBreak } from "../lib/pageBreak";
import { protectUnsupportedMarkdown, RawMarkdownBlock, RawMarkdownInline, RawMarkdownPreview } from "../lib/rawMarkdown";
import { isExternalLink, normalizeLinkTarget } from "../lib/links";
import { currentCodeBlockText, HighlightedCodeBlock } from "../lib/codeBlock";
import { MermaidPreview } from "../lib/mermaidPreview";
import {
  FindReplace,
  findStringMatches,
  findTextMatches,
  replaceAllMatches,
  replaceStringMatches,
  replaceTextMatch,
  selectTextMatch,
  showFindMatches,
} from "../lib/findReplace";
import { copyPlainText, openExternalUrl } from "../lib/api";
import { DocumentOutline } from "./DocumentOutline";
import { countWritingStatistics, type WritingStatistics } from "../lib/statistics";
import {
  AdjacentTableResizing,
  isTableResizeBoundary,
  TABLE_CELL_MIN_WIDTH,
  TABLE_RESIZE_HANDLE_WIDTH,
} from "../lib/tableResize";
import {
  PersistentSelection,
  applyPersistentSelection,
  isPrimarySelectionButton,
  isSelectionSafeTarget,
  readEditorSelection,
  shouldPublishNativeSelection,
  type EditorSelectionSnapshot,
} from "../lib/persistentSelection";
import { centerEditorSelection } from "../lib/typewriter";
import { MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript } from "../lib/extendedMarks";
import { imageExtension } from "../lib/editorImage";
import { shouldEmitEditorUpdate } from "../lib/editorUpdate";
import { EditorToolbar } from "./EditorToolbar";
import { FindReplaceBar, LinkEditorBar, type LinkRange } from "./EditorBars";
import {
  idleSelectionLifecycle,
  reduceSelectionLifecycle,
  shouldPublishSelectionChange,
} from "../lib/selectionLifecycle";
import { EditorImageBars, useEditorImages, useMissingImageListener } from "./EditorImages";
import type { SpecialSelectionMode } from "../lib/selectionPreferences";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

interface EditorPaneProps {
  workspace: string;
  documentPath: string;
  markdownText: string;
  tableLayouts: TableLayout[];
  imageLayouts?: ImageLayout[];
  specialSelectionMode?: SpecialSelectionMode;
  onChange: (markdown: string, document: TiptapNode | null) => void;
  onSelection: (text: string) => void;
  onOpenAi: () => void;
  onStatistics?: (statistics: WritingStatistics) => void;
}

interface SelectionPopover {
  left: number;
  top: number;
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const headingLevels: HeadingLevel[] = [1, 2, 3, 4, 5, 6];
const emptyImageLayouts: ImageLayout[] = [];
export function shouldStartPointerSelection(event: MouseEvent | PointerEvent): boolean {
  return isPrimarySelectionButton(event.button)
    && !isTableResizeBoundary(event.target, event.clientX);
}

export function shouldReplaceEditorDocument(current: ProseMirrorNode, restored: ProseMirrorNode): boolean {
  return !restored.eq(current);
}

export function EditorPane({ workspace, documentPath, markdownText, tableLayouts, imageLayouts = emptyImageLayouts, specialSelectionMode = "visible", onChange, onSelection, onOpenAi, onStatistics }: EditorPaneProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState(markdownText);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkRange, setLinkRange] = useState<LinkRange | null>(null);
  const [codeCopyState, setCodeCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [typewriterMode, setTypewriterMode] = useState(() => localStorage.getItem("yuling-typewriter-mode") === "true");
  const [selectionPopover, setSelectionPopover] = useState<SelectionPopover | null>(null);
  const frontmatter = useRef(frontmatterEnvelope(markdownText).frontmatter);
  const lastIncomingMarkdown = useRef(markdownText);
  const lastLocalEmission = useRef<string | null>(null);
  const pointerSelecting = useRef(false);
  const selectionLifecycle = useRef(idleSelectionLifecycle);
  const suppressSelectionUpdate = useRef(false);
  const selectionSnapshot = useRef<EditorSelectionSnapshot | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const selectionFrame = useRef<number | null>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const codeMirror = useRef<ReactCodeMirrorRef>(null);
  const sourceEmojiRange = useRef<{ from: number; to: number } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const images = useEditorImages(workspace, editorRef);
  const callbacks = useRef({ onChange, onSelection, onStatistics });
  const typewriterModeRef = useRef(typewriterMode);
  callbacks.current = { onChange, onSelection, onStatistics };
  typewriterModeRef.current = typewriterMode;

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
    callbacks.current.onSelection("");
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
    if (
      !previous
      || previous.from !== snapshot.from
      || previous.to !== snapshot.to
      || previous.text !== snapshot.text
    ) {
      callbacks.current.onSelection(snapshot.text);
    }
    positionPopover(currentEditor.view, snapshot);
  };

  const extensions = useMemo(
    () => [
      StarterKit.configure({ link: { openOnClick: false }, codeBlock: false }),
      Markdown.configure({ indentation: { style: "space", size: 2 } }),
      HighlightedCodeBlock,
      MermaidPreview,
      AdjacentTableResizing,
      TableKit.configure({
        table: {
          resizable: true,
          cellMinWidth: TABLE_CELL_MIN_WIDTH,
          handleWidth: TABLE_RESIZE_HANDLE_WIDTH,
          lastColumnResizable: true,
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      BlockMath,
      InlineMath,
      PageBreak,
      FindReplace,
      RawMarkdownBlock,
      RawMarkdownInline,
      RawMarkdownPreview,
      PersistentSelection,
      MarkdownHighlight,
      MarkdownSubscript,
      MarkdownSuperscript,
      imageExtension(workspace),
    ],
    [workspace],
  );

  const sourceExtensions = useMemo(() => [markdown(), search()], []);

  const editor = useEditor(
    {
      extensions,
      content: protectUnsupportedMarkdown(frontmatterEnvelope(markdownText).body),
      contentType: "markdown",
      editorProps: {
        attributes: { class: "yuling-prose", spellcheck: "true" },
        handleDOMEvents: {
          contextmenu: (view) => {
            selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, { type: "context-menu" });
            const snapshot = selectionSnapshot.current;
            if (!snapshot || snapshot.to > view.state.doc.content.size) return false;
            suppressSelectionUpdate.current = true;
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, snapshot.anchor, snapshot.head)));
            suppressSelectionUpdate.current = false;
            window.requestAnimationFrame(() => positionPopover(view, snapshot));
            return false;
          },
          blur: (view) => {
            selectionLifecycle.current = reduceSelectionLifecycle(selectionLifecycle.current, { type: "blur" });
            const snapshot = selectionSnapshot.current;
            if (snapshot && snapshot.to <= view.state.doc.content.size) {
              window.requestAnimationFrame(() => {
                if (selectionSnapshot.current === snapshot && editor && !editor.isDestroyed) {
                  applyPersistentSelection(editor, { from: snapshot.from, to: snapshot.to });
                }
              });
            }
            return false;
          },
        },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.items ?? []).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
          if (!files.some((file) => file.type.startsWith("image/"))) return false;
          event.preventDefault();
          void images.importFiles(files);
          return true;
        },
        handleDrop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (!files.some((file) => file.type.startsWith("image/"))) return false;
          event.preventDefault();
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (position !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position))));
          void images.importFiles(files);
          return true;
        },
      },
      onUpdate: ({ editor: currentEditor, transaction }) => {
        if (!shouldEmitEditorUpdate(transaction)) return;
        if (selectionSnapshot.current) {
          selectionSnapshot.current = null;
          setSelectionPopover(null);
          callbacks.current.onSelection("");
        }
        const markdownBody = currentEditor.getMarkdown();
        const nextMarkdown = joinFrontmatter(frontmatter.current, markdownBody);
        lastLocalEmission.current = nextMarkdown;
        callbacks.current.onChange(nextMarkdown, currentEditor.getJSON());
        callbacks.current.onStatistics?.(countWritingStatistics(currentEditor.state.doc.textBetween(0, currentEditor.state.doc.content.size, "\n")));
        if (typewriterModeRef.current) window.requestAnimationFrame(() => centerEditorSelection(currentEditor.view));
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        if (!pointerSelecting.current && !suppressSelectionUpdate.current) publishSelection(currentEditor);
        if (typewriterModeRef.current) window.requestAnimationFrame(() => centerEditorSelection(currentEditor.view));
      },
    },
    [documentPath, extensions],
  );
  editorRef.current = editor;

  const imageState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      active: currentEditor?.isActive("image") ?? false,
      attrs: currentEditor?.getAttributes("image") ?? {},
    }),
  });

  useMissingImageListener(editor, images.setMissing, images.setError);

  const toolbarState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      blockStyle: currentEditor
        ? headingLevels.find((level) => currentEditor.isActive("heading", { level })) ?? "paragraph"
        : "paragraph" as const,
      bold: currentEditor?.isActive("bold") ?? false,
      italic: currentEditor?.isActive("italic") ?? false,
      strike: currentEditor?.isActive("strike") ?? false,
      code: currentEditor?.isActive("code") ?? false,
      bulletList: currentEditor?.isActive("bulletList") ?? false,
      orderedList: currentEditor?.isActive("orderedList") ?? false,
      taskList: currentEditor?.isActive("taskList") ?? false,
      blockquote: currentEditor?.isActive("blockquote") ?? false,
      codeBlock: currentEditor?.isActive("codeBlock") ?? false,
      codeLanguage: String(currentEditor?.getAttributes("codeBlock").language ?? "plaintext"),
      canUndo: currentEditor?.can().undo() ?? false,
      canRedo: currentEditor?.can().redo() ?? false,
    }),
  });

  const openLinkEditor = () => {
    if (!editor || sourceMode) return;
    const selection = editor.state.selection;
    const markRange = selection.empty
      ? getMarkRange(selection.$from, editor.schema.marks.link)
      : undefined;
    const from = markRange?.from ?? selection.from;
    const to = markRange?.to ?? selection.to;
    const existing = Boolean(markRange || editor.isActive("link"));
    setFindOpen(false);
    setLinkRange({ from, to, existing });
    setLinkText(editor.state.doc.textBetween(from, to));
    setLinkUrl(existing ? String(editor.getAttributes("link").href ?? "") : "");
    setLinkError(null);
    setLinkOpen(true);
  };

  useEffect(() => {
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
      const nativeSelection = window.getSelection();
      const usable = shouldPublishNativeSelection(nativeSelection, editorDom);
      if (shouldPublishSelectionChange(selectionLifecycle.current, suppressSelectionUpdate.current, usable)) {
        scheduleStablePublish();
      }
    };
    const clearFromOutside = (event: PointerEvent) => {
      if (!selectionSnapshot.current || isSelectionSafeTarget(event.target)) return;
      clearPublishedSelection(editor, true);
    };
    const clearFromEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !selectionSnapshot.current) return;
      clearPublishedSelection(editor, true);
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
  }, [editor, specialSelectionMode]);

  useEffect(() => {
    const handleFindShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        setLinkOpen(false);
        setFindOpen(true);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        openLinkEditor();
        return;
      }
      if (event.key === "Escape" && (findOpen || linkOpen || outlineOpen)) {
        event.preventDefault();
        setFindOpen(false);
        setLinkOpen(false);
        setOutlineOpen(false);
      }
    };
    window.addEventListener("keydown", handleFindShortcut);
    return () => window.removeEventListener("keydown", handleFindShortcut);
  }, [findOpen, linkOpen, openLinkEditor, outlineOpen]);

  useEffect(() => setOutlineOpen(false), [documentPath]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    callbacks.current.onStatistics?.(countWritingStatistics(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")));
  }, [documentPath, editor]);

  useEffect(() => {
    if (!findOpen) return;
    window.requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }, [findOpen]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (!findOpen || sourceMode) {
      showFindMatches(editor, "", 0);
      return;
    }
    const matches = findTextMatches(editor.state.doc, findQuery);
    const activeIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
    showFindMatches(editor, findQuery, activeIndex);
    const match = matches[activeIndex];
    if (!match) return;
    suppressSelectionUpdate.current = true;
    selectTextMatch(editor, match);
    suppressSelectionUpdate.current = false;
    setSelectionPopover(null);
  }, [editor, findIndex, findOpen, findQuery, markdownText, sourceMode]);

  useEffect(() => {
    const view = codeMirror.current?.view;
    if (!sourceMode || !view) return;
    const query = findOpen ? findQuery : "";
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive: false, literal: true })) });
    const matches = findStringMatches(sourceText, query);
    const activeIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;
    const match = matches[activeIndex];
    if (match) view.dispatch({ selection: { anchor: match.from, head: match.to }, scrollIntoView: true });
  }, [findIndex, findOpen, findQuery, sourceMode, sourceText]);

  useEffect(() => {
    const incomingChanged = markdownText !== lastIncomingMarkdown.current;
    lastIncomingMarkdown.current = markdownText;
    if (isLocalEditorEcho(markdownText, lastLocalEmission.current)) return;
    lastLocalEmission.current = null;
    if (incomingChanged) {
      const envelope = frontmatterEnvelope(markdownText);
      frontmatter.current = envelope.frontmatter;
      setSourceText(markdownText);
      if (editor) {
        editor.commands.setContent(protectUnsupportedMarkdown(envelope.body), { contentType: "markdown", emitUpdate: false });
      }
    }
    if (editor && (tableLayouts.length || imageLayouts.length)) {
      const restored = applyImageLayouts(applyTableLayouts(editor.getJSON(), tableLayouts), imageLayouts);
      const restoredDocument = editor.schema.nodeFromJSON(restored);
      if (shouldReplaceEditorDocument(editor.state.doc, restoredDocument)) {
        editor.commands.setContent(restored, { emitUpdate: false });
      }
    }
  }, [documentPath, editor, imageLayouts, markdownText, tableLayouts]);

  const toggleSource = () => {
    setOutlineOpen(false);
    if (editor && selectionSnapshot.current) clearPublishedSelection(editor, true);
    if (sourceMode && editor) {
      const envelope = frontmatterEnvelope(sourceText);
      frontmatter.current = envelope.frontmatter;
      editor.commands.setContent(protectUnsupportedMarkdown(envelope.body), { contentType: "markdown", emitUpdate: false });
      lastLocalEmission.current = sourceText;
      callbacks.current.onChange(sourceText, editor.getJSON());
    } else if (editor) {
      setSourceText(joinFrontmatter(frontmatter.current, editor.getMarkdown()));
    }
    setSourceMode((value) => !value);
  };

  const command = (run: () => unknown) => {
    run();
    editor?.commands.focus();
  };

  const applyLink = () => {
    if (!editor || !linkRange) return;
    try {
      const href = normalizeLinkTarget(linkUrl);
      const text = linkText.trim();
      if (!text) throw new Error("链接文字不能为空");
      editor.chain()
        .focus()
        .setTextSelection({ from: linkRange.from, to: linkRange.to })
        .insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] })
        .run();
      setLinkError(null);
      setLinkOpen(false);
    } catch (reason) {
      setLinkError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  const removeLink = () => {
    if (!editor || !linkRange?.existing) return;
    editor.chain().focus().setTextSelection({ from: linkRange.from, to: linkRange.to }).unsetLink().run();
    setLinkOpen(false);
  };

  const openCurrentLink = () => {
    try {
      const href = normalizeLinkTarget(linkUrl);
      if (!isExternalLink(href)) throw new Error("相对链接请在文档库内打开");
      setLinkError(null);
      void openExternalUrl(href).catch((reason) => setLinkError(String(reason)));
    } catch (reason) {
      setLinkError(String(reason instanceof Error ? reason.message : reason));
    }
  };

  const copyCurrentCode = () => {
    if (!editor) return;
    const code = currentCodeBlockText(editor);
    if (code === null) return;
    void copyPlainText(code)
      .then(() => {
        setCodeCopyState("copied");
        window.setTimeout(() => setCodeCopyState("idle"), 1200);
      })
      .catch(() => setCodeCopyState("error"));
  };

  const matches = findQuery
    ? sourceMode
      ? findStringMatches(sourceText, findQuery)
      : editor ? findTextMatches(editor.state.doc, findQuery) : []
    : [];
  const activeFindIndex = matches.length ? Math.min(findIndex, matches.length - 1) : 0;

  const moveToMatch = (direction: 1 | -1) => {
    if (!matches.length) return;
    setFindIndex((activeFindIndex + direction + matches.length) % matches.length);
  };

  const publishSourceReplacement = (nextSource: string) => {
    setSourceText(nextSource);
    lastLocalEmission.current = nextSource;
    callbacks.current.onChange(nextSource, null);
  };

  const rememberEmojiPosition = () => {
    if (!sourceMode) return;
    const range = codeMirror.current?.view?.state.selection.main;
    sourceEmojiRange.current = range ? { from: range.from, to: range.to } : null;
  };

  const insertEmoji = (emoji: string) => {
    if (!sourceMode) {
      editor.chain().focus().insertContent(emoji).run();
      return;
    }
    const view = codeMirror.current?.view;
    if (!view) {
      publishSourceReplacement(sourceText + emoji);
      return;
    }
    const range = sourceEmojiRange.current ?? view.state.selection.main;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: emoji },
      selection: { anchor: range.from + emoji.length },
      scrollIntoView: true,
    });
    sourceEmojiRange.current = null;
    view.focus();
  };

  const replaceCurrentMatch = () => {
    const match = matches[activeFindIndex];
    if (!match) return;
    if (sourceMode) {
      publishSourceReplacement(replaceStringMatches(sourceText, [match], replacement));
    } else if (editor) {
      replaceTextMatch(editor, match, replacement);
    }
    setFindIndex(Math.min(activeFindIndex, Math.max(0, matches.length - 2)));
  };

  const replaceEveryMatch = () => {
    if (!matches.length) return;
    if (sourceMode) {
      publishSourceReplacement(replaceStringMatches(sourceText, matches, replacement));
    } else if (editor) {
      replaceAllMatches(editor, matches, replacement);
    }
    setFindIndex(0);
  };

  if (!editor) return <div className="editor-loading">正在准备编辑器…</div>;
  return (
    <section className={`editor-pane${typewriterMode ? " typewriter-mode" : ""}`} aria-label="Markdown 编辑器">
      <div className="editor-chrome">
        <EditorToolbar editor={editor} state={toolbarState} sourceMode={sourceMode} outlineOpen={outlineOpen}
          typewriterMode={typewriterMode} codeCopyState={codeCopyState} command={command}
          rememberEmojiPosition={rememberEmojiPosition} insertEmoji={insertEmoji} copyCode={copyCurrentCode}
          insertImage={() => { images.replacementPosition.current = null; images.input.current?.click(); }}
          toggleOutline={() => { setFindOpen(false); setLinkOpen(false); setOutlineOpen((value) => !value); }}
          openLink={openLinkEditor} openFind={() => { setLinkOpen(false); setFindOpen(true); }}
          toggleTypewriter={() => {
            const next = !typewriterMode;
            setTypewriterMode(next);
            localStorage.setItem("yuling-typewriter-mode", String(next));
            if (next) window.requestAnimationFrame(() => centerEditorSelection(editor.view));
          }} toggleSource={toggleSource} />
        {findOpen && (
          <FindReplaceBar inputRef={findInput} query={findQuery} replacement={replacement}
            matchCount={matches.length} activeIndex={activeFindIndex}
            setQuery={(value) => { setFindQuery(value); setFindIndex(0); }} setReplacement={setReplacement}
            move={moveToMatch} replaceCurrent={replaceCurrentMatch} replaceAll={replaceEveryMatch}
            close={() => setFindOpen(false)} />
        )}
        {linkOpen && (
          <LinkEditorBar text={linkText} url={linkUrl} range={linkRange} error={linkError}
            setText={setLinkText} setUrl={(value) => { setLinkUrl(value); setLinkError(null); }}
            apply={applyLink} remove={removeLink} open={openCurrentLink} close={() => setLinkOpen(false)} />
        )}
        {!sourceMode && <EditorImageBars editor={editor} active={imageState?.active ?? false} attrs={imageState?.attrs ?? {}} images={images} />}
      </div>
      {outlineOpen && !sourceMode && <DocumentOutline editor={editor} onClose={() => setOutlineOpen(false)} />}
      {sourceMode ? (
        <CodeMirror
          ref={codeMirror}
          className="source-editor"
          value={sourceText}
          height="100%"
          extensions={sourceExtensions}
          onChange={(value) => {
            setSourceText(value);
            lastLocalEmission.current = value;
            callbacks.current.onChange(value, null);
          }}
        />
      ) : (
        <div
          className="editor-scroll"
          onScroll={() => {
            if (!selectionSnapshot.current) return;
            if (scrollFrame.current !== null) window.cancelAnimationFrame(scrollFrame.current);
            scrollFrame.current = window.requestAnimationFrame(() => {
              scrollFrame.current = null;
              if (selectionSnapshot.current) positionPopover(editor.view, selectionSnapshot.current);
            });
          }}
        >
          <EditorContent editor={editor} />
        </div>
      )}
      {selectionPopover && !sourceMode && (
        <button
          className="selection-popover"
          style={{ left: selectionPopover.left, top: selectionPopover.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setSelectionPopover(null);
            onOpenAi();
          }}
        >
          <span aria-hidden="true">✦</span>知了知道
        </button>
      )}
    </section>
  );
}
