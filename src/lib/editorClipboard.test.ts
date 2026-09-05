// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { describe, expect, it } from "vitest";
import { selectedHtml, selectedMarkdown } from "./editorClipboard";

describe("editor clipboard formats", () => {
  it("serializes the selected rich text as Markdown and safe HTML", () => {
    const editor = new Editor({ extensions: [StarterKit, Markdown], content: "<p><strong>毓灵</strong> Markdown</p>" });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    expect(selectedMarkdown(editor)).toBe("**毓灵**");
    expect(selectedHtml(editor)).toContain("<strong>毓灵</strong>");
  });
});
