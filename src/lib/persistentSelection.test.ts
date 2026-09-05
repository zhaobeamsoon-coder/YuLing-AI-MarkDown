// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { BlockMath, InlineMath } from "./math";
import { RawMarkdownBlock, RawMarkdownInline } from "./rawMarkdown";
import {
  PersistentSelection,
  applyPersistentSelection,
  isPrimarySelectionButton,
  isSelectionSafeTarget,
  readEditorSelection,
} from "./persistentSelection";

describe("persistent editor selection", () => {
  it("starts pointer selection only from the primary button", () => {
    expect(isPrimarySelectionButton(0)).toBe(true);
    expect(isPrimarySelectionButton(1)).toBe(false);
    expect(isPrimarySelectionButton(2)).toBe(false);
  });

  it("keeps selection while using the editor, popover, or Zhi Liao panel", () => {
    document.body.innerHTML = `
      <div class="yuling-prose"><span id="editor-target">正文</span></div>
      <div class="editor-toolbar"><button id="toolbar-target">粗体</button></div>
      <button class="selection-popover" id="popover-target">知了知道</button>
      <aside class="ai-panel"><button id="ai-target">解释</button></aside>
      <button id="outside-target">其他区域</button>
    `;

    expect(isSelectionSafeTarget(document.querySelector("#editor-target"))).toBe(true);
    expect(isSelectionSafeTarget(document.querySelector("#toolbar-target"))).toBe(true);
    expect(isSelectionSafeTarget(document.querySelector("#popover-target"))).toBe(true);
    expect(isSelectionSafeTarget(document.querySelector("#ai-target"))).toBe(true);
    expect(isSelectionSafeTarget(document.querySelector("#outside-target"))).toBe(false);
  });

  it("renders a non-document decoration and clears it when requested", () => {
    const editor = new Editor({
      extensions: [StarterKit, PersistentSelection],
      content: "<p>alpha beta</p>",
    });

    let historyMeta: unknown;
    editor.on("transaction", ({ transaction }) => {
      historyMeta = transaction.getMeta("addToHistory");
    });
    applyPersistentSelection(editor, { from: 1, to: 6 });
    expect(editor.view.dom.querySelector(".yuling-persistent-selection")?.textContent).toBe("alpha");
    expect(editor.getText()).toBe("alpha beta");
    expect(historyMeta).toBe(false);

    applyPersistentSelection(editor, null);
    expect(editor.view.dom.querySelector(".yuling-persistent-selection")).toBeNull();
    expect(editor.getText()).toBe("alpha beta");
    editor.destroy();
  });

  it("preserves multi-line text and reverse-selection direction", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>first</p><p>second</p>",
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 14, 1)));

    expect(readEditorSelection(editor)).toEqual({
      from: 1,
      to: 14,
      anchor: 14,
      head: 1,
      text: "first\nsecond",
    });
    editor.destroy();
  });

  it("reads the native DOM range when WebKit has not synced ProseMirror yet", () => {
    const editor = new Editor({
      extensions: [StarterKit],
      content: "<p>alpha beta</p>",
    });
    document.body.appendChild(editor.view.dom);
    const textNode = editor.view.dom.querySelector("p")?.firstChild;
    expect(textNode).toBeTruthy();

    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 5);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    expect(editor.state.selection.empty).toBe(true);
    expect(readEditorSelection(editor)).toMatchObject({ from: 1, to: 6, text: "alpha" });
    editor.destroy();
  });

  it("uses the original LaTeX when a rendered formula is selected", () => {
    const editor = new Editor({
      extensions: [StarterKit, InlineMath, BlockMath],
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "公式 " },
            { type: "yulingInlineMath", attrs: { latex: "E=mc^2" } },
            { type: "text", text: " 很重要" },
          ],
        }],
      },
    });
    document.body.appendChild(editor.view.dom);
    const formula = editor.view.dom.querySelector<HTMLElement>(".yuling-math-inline")!;
    const textNode = formula.querySelector(".katex")?.firstChild?.firstChild ?? formula.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(formula);
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.addRange(range);

    expect(readEditorSelection(editor)?.text).toBe("$E=mc^2$");
    editor.destroy();
  });

  it("keeps text and LaTeX in document order across a formula", () => {
    const editor = new Editor({
      extensions: [StarterKit, InlineMath, BlockMath],
      content: {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [
            { type: "text", text: "前文 " },
            { type: "yulingInlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " 后文" },
          ],
        }],
      },
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(
      editor.state.doc,
      1,
      editor.state.doc.content.size - 1,
    )));

    expect(readEditorSelection(editor)?.text).toBe("前文 $x^2$ 后文");
    editor.destroy();
  });

  it("reads the exact visible substring selected inside a raw Markdown atom", () => {
    const editor = new Editor({
      extensions: [StarterKit, RawMarkdownBlock, RawMarkdownInline],
      content: {
        type: "doc",
        content: [{ type: "yulingRawMarkdownBlock", attrs: { raw: "<details>屏幕文字</details>" } }],
      },
    });
    document.body.appendChild(editor.view.dom);
    const raw = editor.view.dom.querySelector<HTMLElement>("[data-yuling-raw-markdown]")!;
    const text = raw.firstChild!;
    const range = document.createRange();
    range.setStart(text, 9);
    range.setEnd(text, 13);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    expect(readEditorSelection(editor, "visible")).toMatchObject({
      from: 0,
      to: 1,
      text: "屏幕文字",
      decoration: "node",
    });
    editor.destroy();
  });

  it("returns complete raw Markdown in source mode and decorates its atom", () => {
    const rawSource = "[^note]: 脚注 **原文**";
    const editor = new Editor({
      extensions: [StarterKit, RawMarkdownBlock, PersistentSelection],
      content: { type: "doc", content: [{ type: "yulingRawMarkdownBlock", attrs: { raw: rawSource } }] },
    });
    document.body.appendChild(editor.view.dom);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)));
    window.getSelection()!.removeAllRanges();

    const snapshot = readEditorSelection(editor, "markdown")!;
    expect(snapshot.text).toBe(rawSource);
    expect(snapshot.decoration).toBe("node");
    applyPersistentSelection(editor, snapshot);
    expect(editor.view.dom.querySelector(".yuling-persistent-selection")?.textContent).toContain("脚注");
    editor.destroy();
  });

  it("keeps document order across ordinary text and a raw atom in both modes", () => {
    const editor = new Editor({
      extensions: [StarterKit, RawMarkdownInline],
      content: { type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "前文" },
        { type: "yulingRawMarkdownInline", attrs: { raw: "[^note]" } },
        { type: "text", text: "后文" },
      ] }] },
    });
    document.body.appendChild(editor.view.dom);
    const paragraph = editor.view.dom.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 0);
    range.setEnd(paragraph.lastChild!, 2);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    expect(readEditorSelection(editor, "visible")?.text).toBe("前文note后文");
    expect(readEditorSelection(editor, "markdown")?.text).toBe("前文[^note]后文");
    editor.destroy();
  });
});
