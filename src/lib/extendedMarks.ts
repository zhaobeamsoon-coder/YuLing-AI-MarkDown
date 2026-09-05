import { Mark } from "@tiptap/core";

function extendedMark(name: string, tag: "mark" | "sub" | "sup", delimiter: string, pattern: RegExp) {
  return Mark.create({
    name,
    parseHTML() { return [{ tag }]; },
    renderHTML() { return [tag, 0]; },
    markdownTokenName: name,
    markdownTokenizer: {
      name,
      level: "inline",
      start: (source: string) => source.indexOf(delimiter),
      tokenize(source: string) {
        const match = pattern.exec(source);
        return match ? {
          type: name,
          raw: match[0],
          text: match[1],
        } : undefined;
      },
    },
    parseMarkdown: (token, helpers) => {
      const text = token.text ?? "";
      return helpers.applyMark(name, helpers.tokenizeInline?.(text) ?? [helpers.createTextNode(text)]);
    },
    renderMarkdown: (node, helpers) => `${delimiter}${helpers.renderChildren(node)}${delimiter}`,
  });
}

export const MarkdownHighlight = extendedMark("yulingHighlight", "mark", "==", /^==(?=\S)([^=\n]*?\S)==(?![=])/);
export const MarkdownSubscript = extendedMark("yulingSubscript", "sub", "~", /^~(?!~)(\S(?:[^~\n]*?\S)?)~(?!~)/);
export const MarkdownSuperscript = extendedMark("yulingSuperscript", "sup", "^", /^\^(?!\^)(\S(?:[^\^\n]*?\S)?)\^(?!\^)/);

export const commonEmoji = ["😀", "😊", "🤔", "👍", "✅", "⚠️", "💡", "📌", "❤️", "🎉"] as const;
