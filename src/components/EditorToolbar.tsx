import type { Editor } from "@tiptap/core";
import { codeLanguageOptions } from "../lib/codeBlock";
import { copyPlainText, copyRichText, readPlainText } from "../lib/api";
import { selectedHtml, selectedMarkdown } from "../lib/editorClipboard";
import { alignSelectedTableColumns, currentTableAlignment } from "../lib/tableAlignment";
import { EmojiPicker } from "./EmojiPicker";
import { SortableToolbar } from "./SortableToolbar";

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
const headingLevels: HeadingLevel[] = [1, 2, 3, 4, 5, 6];

export interface EditorToolbarState {
  blockStyle: HeadingLevel | "paragraph";
  bold: boolean; italic: boolean; strike: boolean; code: boolean;
  bulletList: boolean; orderedList: boolean; taskList: boolean; blockquote: boolean;
  codeBlock: boolean; codeLanguage: string; canUndo: boolean; canRedo: boolean;
}

export function EditorToolbar(props: {
  editor: Editor; state: EditorToolbarState | null; sourceMode: boolean; outlineOpen: boolean;
  typewriterMode: boolean; codeCopyState: "idle" | "copied" | "error";
  command: (run: () => unknown) => void; rememberEmojiPosition: () => void;
  insertEmoji: (emoji: string) => void; copyCode: () => void; insertImage: () => void;
  toggleOutline: () => void; openLink: () => void; openFind: () => void;
  toggleTypewriter: () => void; toggleSource: () => void;
}) {
  const { editor, state, command } = props;
  return <SortableToolbar>
    <select data-toolbar-id="paragraph-style" className="paragraph-style" aria-label="段落样式" value={state?.blockStyle ?? "paragraph"} onChange={(event) => {
      const value = event.target.value;
      command(() => value === "paragraph" ? editor.chain().focus().setParagraph().run() : editor.chain().focus().setHeading({ level: Number(value) as HeadingLevel }).run());
    }}><option value="paragraph">正文</option>{headingLevels.map((level) => <option key={level} value={level}>{["一", "二", "三", "四", "五", "六"][level - 1]}级标题</option>)}</select>
    <button data-toolbar-id="bold" onClick={() => command(() => editor.chain().focus().toggleBold().run())} aria-pressed={state?.bold}>粗体</button>
    <button data-toolbar-id="italic" onClick={() => command(() => editor.chain().focus().toggleItalic().run())} aria-pressed={state?.italic}>斜体</button>
    <button data-toolbar-id="strike" onClick={() => command(() => editor.chain().focus().toggleStrike().run())} aria-pressed={state?.strike}>删除线</button>
    <button data-toolbar-id="inline-code" onClick={() => command(() => editor.chain().focus().toggleCode().run())} aria-pressed={state?.code}>行内代码</button>
    <button data-toolbar-id="highlight" onClick={() => command(() => editor.chain().focus().toggleMark("yulingHighlight").run())} aria-pressed={editor.isActive("yulingHighlight")}>高亮</button>
    <button data-toolbar-id="subscript" onClick={() => command(() => editor.chain().focus().toggleMark("yulingSubscript").run())} aria-pressed={editor.isActive("yulingSubscript")}>下标</button>
    <button data-toolbar-id="superscript" onClick={() => command(() => editor.chain().focus().toggleMark("yulingSuperscript").run())} aria-pressed={editor.isActive("yulingSuperscript")}>上标</button>
    <span data-toolbar-id="emoji"><EmojiPicker onOpen={props.rememberEmojiPosition} onInsert={props.insertEmoji} /></span><span className="toolbar-divider" />
    <button data-toolbar-id="bullet-list" onClick={() => command(() => editor.chain().focus().toggleBulletList().run())} aria-pressed={state?.bulletList}>无序列表</button>
    <button data-toolbar-id="ordered-list" onClick={() => command(() => editor.chain().focus().toggleOrderedList().run())} aria-pressed={state?.orderedList}>有序列表</button>
    <button data-toolbar-id="task-list" onClick={() => command(() => editor.chain().focus().toggleTaskList().run())} aria-pressed={state?.taskList}>任务列表</button>
    <button data-toolbar-id="blockquote" onClick={() => command(() => editor.chain().focus().toggleBlockquote().run())} aria-pressed={state?.blockquote}>引用</button>
    <button data-toolbar-id="horizontal-rule" onClick={() => command(() => editor.chain().focus().setHorizontalRule().run())}>分隔线</button>
    <button data-toolbar-id="undo" disabled={!state?.canUndo} onClick={() => command(() => editor.chain().focus().undo().run())}>撤销</button>
    <button data-toolbar-id="redo" disabled={!state?.canRedo} onClick={() => command(() => editor.chain().focus().redo().run())}>重做</button><span className="toolbar-divider" />
    <button data-toolbar-id="code-block" onClick={() => command(() => editor.chain().focus().toggleCodeBlock().run())} aria-pressed={state?.codeBlock}>代码块</button>
    <select data-toolbar-id="code-language" className="code-language" aria-label="代码语言" disabled={!state?.codeBlock} value={state?.codeLanguage ?? "plaintext"} onChange={(event) => command(() => editor.chain().focus().updateAttributes("codeBlock", { language: event.target.value }).run())}>
      {!codeLanguageOptions.some(([value]) => value === state?.codeLanguage) && <option value={state?.codeLanguage}>{state?.codeLanguage}</option>}{codeLanguageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <button data-toolbar-id="copy-code" disabled={!state?.codeBlock} aria-label="复制代码" onClick={props.copyCode}>{props.codeCopyState === "copied" ? "已复制" : props.codeCopyState === "error" ? "复制失败" : "复制代码"}</button>
    <button data-toolbar-id="insert-image" onClick={props.insertImage}>插入图片</button><span className="toolbar-divider" />
    <button data-toolbar-id="insert-table" onClick={() => command(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>插入表格</button>
    <button data-toolbar-id="add-column" onClick={() => command(() => editor.chain().focus().addColumnAfter().run())}>加列</button><button data-toolbar-id="add-row" onClick={() => command(() => editor.chain().focus().addRowAfter().run())}>加行</button>
    <button data-toolbar-id="delete-column" onClick={() => command(() => editor.chain().focus().deleteColumn().run())}>删列</button><button data-toolbar-id="delete-row" onClick={() => command(() => editor.chain().focus().deleteRow().run())}>删行</button>
    <button data-toolbar-id="merge-split" onClick={() => command(() => editor.chain().focus().mergeOrSplit().run())}>合并/拆分</button>
    {(["left", "center", "right"] as const).map((alignment) => <button key={alignment} data-toolbar-id={`align-${alignment}`} disabled={!editor.isActive("table")} aria-pressed={currentTableAlignment(editor) === alignment} onClick={() => command(() => alignSelectedTableColumns(editor, alignment))}>{alignment === "left" ? "左对齐" : alignment === "center" ? "居中" : "右对齐"}</button>)}
    <button data-toolbar-id="page-break" onClick={() => command(() => editor.commands.insertContent({ type: "yulingPageBreak" }))}>分页</button><span className="toolbar-spacer" />
    <button data-toolbar-id="copy-markdown" disabled={props.sourceMode} onClick={() => void copyPlainText(selectedMarkdown(editor))}>复制 Markdown</button>
    <button data-toolbar-id="copy-rich-text" disabled={props.sourceMode} onClick={() => void copyRichText(selectedHtml(editor), editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, "\n"))}>复制富文本</button>
    <button data-toolbar-id="paste-plain-text" disabled={props.sourceMode} onClick={() => void readPlainText().then((text) => editor.chain().focus().insertContent(text).run())}>粘贴纯文本</button>
    <button data-toolbar-id="outline" disabled={props.sourceMode} aria-pressed={props.outlineOpen} onClick={props.toggleOutline}>大纲</button>
    <button data-toolbar-id="link" disabled={props.sourceMode} onClick={props.openLink} title="插入或编辑链接（⌘K）">链接</button><button data-toolbar-id="find" onClick={props.openFind} title="查找与替换（⌘F）">查找</button>
    <button data-toolbar-id="typewriter" disabled={props.sourceMode} aria-pressed={props.typewriterMode} onClick={props.toggleTypewriter}>打字机</button><button data-toolbar-id="source-mode" onClick={props.toggleSource}>{props.sourceMode ? "所见即所得" : "Markdown 源码"}</button>
  </SortableToolbar>;
}
