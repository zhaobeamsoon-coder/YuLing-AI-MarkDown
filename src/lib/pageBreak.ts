import { Node } from "@tiptap/core";

const marker = "<!-- yuling:pagebreak -->";

export const PageBreak = Node.create({
  name: "yulingPageBreak",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-yuling-pagebreak]" }];
  },

  renderHTML() {
    return ["div", { class: "yuling-page-break", "data-yuling-pagebreak": "true", "aria-label": "分页符" }];
  },

  markdownTokenName: "yulingPageBreak",
  markdownTokenizer: {
    name: "yulingPageBreak",
    level: "block",
    start: (source: string) => source.indexOf(marker),
    tokenize(source: string) {
      const match = /^[ \t]*<!--\s*yuling:pagebreak\s*-->[ \t]*(?:\n|$)/i.exec(source);
      return match ? { type: "yulingPageBreak", raw: match[0] } : undefined;
    },
  },
  parseMarkdown: (_token, helpers) => helpers.createNode("yulingPageBreak"),
  renderMarkdown: () => `\n${marker}\n`,
});
