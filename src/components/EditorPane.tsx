import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { search } from "@codemirror/search";
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
import { FindReplace } from "../lib/findReplace";
import { copyPlainText, openExternalUrl } from "../lib/api";
import { DocumentOutline } from "./DocumentOutline";
import { countWritingStatistics, type WritingStatistics } from "../lib/statistics";
import {
  AdjacentTableResizing,
  TABLE_CELL_MIN_WIDTH,
  TABLE_RESIZE_HANDLE_WIDTH,
} from "../lib/tableResize";
import { PersistentSelection } from "../lib/persistentSelection";
import { centerEditorSelection } from "../lib/typewriter";
import { MarkdownHighlight, MarkdownSubscript, MarkdownSuperscript } from "../lib/extendedMarks";
import { imageExtension } from "../lib/editorImage";
import { shouldEmitEditorUpdate } from "../lib/editorUpdate";
import { EditorToolbar } from "./EditorToolbar";
import { FindReplaceBar, LinkEditorBar, type LinkRange } from "./EditorBars";
import { EditorImageBars, useEditorImages, useMissingImageListener } from "./EditorImages";
import type { SpecialSelectionMode } from "../lib/selectionPreferences";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  shouldStartPointerSelection,
  usePersistentEditorSelection,
  type SelectionPopover,
} from "../lib/usePersistentEditorSelection";
import { useEditorFind } from "../lib/useEditorFind";

export { shouldStartPointerSelection } from "../lib/usePersistentEditorSelection";

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

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const headingLevels: HeadingLevel[] = [1, 2, 3, 4, 5, 6];
const emptyImageLayouts: ImageLayout[] = [];
export function shouldReplaceEditorDocument(current: ProseMirrorNode, restored: ProseMirrorNode): boolean {
  return !restored.eq(current);
}

export function EditorPane({ workspace, documentPath, markdownText, tableLayouts, imageLayouts = emptyImageLayouts, specialSelectionMode = "visible", onChange, onSelection, onOpenAi, onStatistics }: EditorPaneProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState(markdownText);
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
  const findInput = useRef<HTMLInputElement>(null);
  const codeMirror = useRef<ReactCodeMirrorRef>(null);
  const sourceEmojiRange = useRef<{ from: number; to: number } | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const images = useEditorImages(workspace, editorRef);
  const callbacks = useRef({ onChange, onSelection, onStatistics });
  const typewriterModeRef = useRef(typewriterMode);
  callbacks.current = { onChange, onSelection, onStatistics };
  typewriterModeRef.current = typewriterMode;
  const {
    clearPublishedSelection, clearSelectionOnEditorUpdate, handleBlur, handleContextMenu,
    handleScroll, handleSelectionUpdate, selectionSnapshot, suppressSelectionUpdate,
  } = usePersistentEditorSelection(editorRef, specialSelectionMode, onSelection, setSelectionPopover);
  const publishSourceReplacement = (nextSource: string) => {
    setSourceText(nextSource);
    lastLocalEmission.current = nextSource;
    callbacks.current.onChange(nextSource, null);
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
          contextmenu: handleContextMenu,
          blur: handleBlur,
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
        clearSelectionOnEditorUpdate();
        const markdownBody = currentEditor.getMarkdown();
        const nextMarkdown = joinFrontmatter(frontmatter.current, markdownBody);
        lastLocalEmission.current = nextMarkdown;
        callbacks.current.onChange(nextMarkdown, currentEditor.getJSON());
        callbacks.current.onStatistics?.(countWritingStatistics(currentEditor.state.doc.textBetween(0, currentEditor.state.doc.content.size, "\n")));
        if (typewriterModeRef.current) window.requestAnimationFrame(() => centerEditorSelection(currentEditor.view));
      },
      onSelectionUpdate: ({ editor: currentEditor }) => {
        handleSelectionUpdate(currentEditor);
        if (typewriterModeRef.current) window.requestAnimationFrame(() => centerEditorSelection(currentEditor.view));
      },
    },
    [documentPath, extensions],
  );
  editorRef.current = editor;
  const {
    findOpen, setFindOpen, findQuery, setFindQuery, replacement, setReplacement,
    setFindIndex, matches, activeFindIndex, moveToMatch, replaceCurrentMatch, replaceEveryMatch,
  } = useEditorFind({
    editor, markdownText, sourceMode, sourceText, codeMirror, findInput,
    suppressSelectionUpdate, setSelectionPopover, publishSourceReplacement,
  });

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
          onScroll={handleScroll}
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
