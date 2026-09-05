import { Node } from "@tiptap/core";
import katex from "katex";

function mathNodeView(displayMode: boolean) {
  return ({ node }: { node: { attrs: { latex?: string } } }) => {
    const dom = document.createElement(displayMode ? "div" : "span");
    dom.className = displayMode ? "yuling-math-block" : "yuling-math-inline";
    dom.dataset.latex = node.attrs.latex ?? "";
    try {
      katex.render(node.attrs.latex ?? "", dom, { displayMode, throwOnError: false, strict: "warn" });
    } catch {
      dom.textContent = displayMode ? `$$${node.attrs.latex ?? ""}$$` : `$${node.attrs.latex ?? ""}$`;
    }
    return { dom };
  };
}

export const BlockMath = Node.create({
  name: "yulingBlockMath",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-yuling-block-math]", getAttrs: (element) => ({ latex: (element as HTMLElement).dataset.latex ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["div", { "data-yuling-block-math": "true", "data-latex": node.attrs.latex }, node.attrs.latex];
  },
  addNodeView() {
    return mathNodeView(true);
  },
  markdownTokenName: "yulingBlockMath",
  markdownTokenizer: {
    name: "yulingBlockMath",
    level: "block",
    start: (source: string) => source.indexOf("$$"),
    tokenize(source: string) {
      const match = /^\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$(?:\n|$)/.exec(source);
      return match ? { type: "yulingBlockMath", raw: match[0], latex: match[1].trim() } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("yulingBlockMath", { latex: token.latex }),
  renderMarkdown: (node) => `\n$$\n${node.attrs?.latex ?? ""}\n$$\n`,
});

export const InlineMath = Node.create({
  name: "yulingInlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "span[data-yuling-inline-math]", getAttrs: (element) => ({ latex: (element as HTMLElement).dataset.latex ?? "" }) }];
  },
  renderHTML({ node }) {
    return ["span", { "data-yuling-inline-math": "true", "data-latex": node.attrs.latex }, node.attrs.latex];
  },
  addNodeView() {
    return mathNodeView(false);
  },
  markdownTokenName: "yulingInlineMath",
  markdownTokenizer: {
    name: "yulingInlineMath",
    level: "inline",
    start: (source: string) => source.indexOf("$"),
    tokenize(source: string) {
      const match = /^\$(?!\$)([^$\n]+?)\$(?!\$)/.exec(source);
      return match ? { type: "yulingInlineMath", raw: match[0], latex: match[1] } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("yulingInlineMath", { latex: token.latex }),
  renderMarkdown: (node) => `$${node.attrs?.latex ?? ""}$`,
});
