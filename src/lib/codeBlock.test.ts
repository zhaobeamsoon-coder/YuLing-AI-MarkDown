// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { HighlightedCodeBlock, currentCodeBlockText } from "./codeBlock";

describe("highlighted fenced code blocks", () => {
  it("keeps the language fence and renders local syntax highlighting", () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ codeBlock: false }), Markdown, HighlightedCodeBlock],
      content: "```python\ndef greet(name):\n    return f\"Hello {name}\"\n```",
      contentType: "markdown",
    });

    expect(editor.getHTML()).toContain("language-python");
    expect(editor.view.dom.innerHTML).toContain("hljs-keyword");
    expect(editor.getMarkdown()).toContain("```python");
    expect(currentCodeBlockText(editor)).toContain("return f");
    editor.commands.updateAttributes("codeBlock", { language: "typescript" });
    expect(editor.getMarkdown()).toContain("```typescript");
    editor.destroy();
  });
});
