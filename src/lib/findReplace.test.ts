// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import {
  FindReplace,
  findTextMatches,
  replaceAllMatches,
  replaceTextMatch,
} from "./findReplace";

describe("current document find and replace", () => {
  it("finds visible text case-insensitively across adjacent marks", () => {
    const editor = new Editor({
      extensions: [StarterKit, FindReplace],
      content: "<p>Yu<strong>Ling</strong> MD，yuling md。</p><p>下一段 YuLing。</p>",
    });

    const matches = findTextMatches(editor.state.doc, "yuling");

    expect(matches).toHaveLength(3);
    expect(editor.state.doc.textBetween(matches[0].from, matches[0].to)).toBe("YuLing");
    editor.destroy();
  });

  it("replaces the active match without changing the other matches", () => {
    const editor = new Editor({ extensions: [StarterKit, FindReplace], content: "<p>词语 词语 词语</p>" });
    const matches = findTextMatches(editor.state.doc, "词语");

    replaceTextMatch(editor, matches[1], "概念");

    expect(editor.getText()).toBe("词语 概念 词语");
    editor.destroy();
  });

  it("replaces every match in one document transaction", () => {
    const editor = new Editor({ extensions: [StarterKit, FindReplace], content: "<p>旧词 旧词</p><p>旧词</p>" });
    const before = editor.state;

    replaceAllMatches(editor, findTextMatches(editor.state.doc, "旧词"), "新词");

    expect(editor.getText({ blockSeparator: "\n" })).toBe("新词 新词\n新词");
    expect(editor.state).not.toBe(before);
    editor.commands.undo();
    expect(editor.getText({ blockSeparator: "\n" })).toBe("旧词 旧词\n旧词");
    editor.destroy();
  });
});
