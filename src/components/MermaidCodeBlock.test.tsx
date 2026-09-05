// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HighlightedCodeBlock } from "../lib/codeBlock";
import { MermaidPreview } from "../lib/mermaidPreview";

const { renderMermaid } = vi.hoisted(() => ({
  renderMermaid: vi.fn(async () => ({ svg: "<svg><text>流程图</text></svg>" })),
}));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: renderMermaid,
  },
}));

describe("MermaidCodeBlock", () => {
  it("keeps Mermaid source editable and renders a local preview", async () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), Markdown, HighlightedCodeBlock, MermaidPreview],
      content: "```mermaid\ngraph TD\nA --> B\n```",
      contentType: "markdown",
    });

    expect(editor.view.dom.textContent).toContain("graph TD");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(renderMermaid).toHaveBeenCalledWith(expect.stringContaining("yuling-mermaid-editor-"), "graph TD\nA --> B");
    expect(editor.view.dom.querySelector("[aria-label='Mermaid 图表预览']")?.textContent).toContain("流程图");
    expect(editor.getMarkdown()).toContain("```mermaid");
    editor.destroy();
  });

  it("does not treat ordinary fenced code as Mermaid", () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), Markdown, HighlightedCodeBlock, MermaidPreview],
      content: "```python\nprint('hello')\n```",
      contentType: "markdown",
    });

    expect(editor.view.dom.querySelector("[aria-label='Mermaid 图表预览']")).toBeNull();
    expect(editor.view.dom.innerHTML).toContain("hljs-built_in");
    editor.destroy();
  });
});
