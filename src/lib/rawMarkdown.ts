import { Extension, Node } from "@tiptap/core";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import remarkParse from "remark-parse";
import { unified } from "unified";

interface PositionedNode {
  type?: string;
  value?: string;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: PositionedNode[];
}

interface ProtectedRange {
  start: number;
  end: number;
  kind: "block" | "inline";
  priority: number;
}

const pageBreakPattern = /^<!--\s*yuling:pagebreak\s*-->$/i;
const blockSentinelPattern = /^<!--yuling-internal-raw-block:([^\n]*?)-->(?:\n|$)/;
const inlineSentinelPattern = /^<!--yuling-internal-raw-inline:([^\n]*?)-->/;
const parser = unified().use(remarkParse);

function encodeRaw(raw: string): string {
  return encodeURIComponent(raw);
}

function decodeRaw(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function addRegexRanges(
  source: string,
  pattern: RegExp,
  kind: ProtectedRange["kind"],
  priority: number,
  ranges: ProtectedRange[],
) {
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined || !match[0]) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length, kind, priority });
  }
}

function collectHtmlRanges(source: string, node: PositionedNode, parentType: string | null, ranges: ProtectedRange[]) {
  if (node.type === "html" && node.position?.start?.offset !== undefined && node.position.end?.offset !== undefined) {
    const raw = source.slice(node.position.start.offset, node.position.end.offset);
    if (!pageBreakPattern.test(raw.trim())) {
      const kind = parentType === "paragraph" || parentType === "heading" ? "inline" : "block";
      ranges.push({
        start: node.position.start.offset,
        end: node.position.end.offset,
        kind,
        priority: kind === "block" ? 80 : 70,
      });
    }
  }
  for (const child of node.children ?? []) collectHtmlRanges(source, child, node.type ?? null, ranges);
}

function selectNonOverlappingRanges(candidates: ProtectedRange[]): ProtectedRange[] {
  const selected: ProtectedRange[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start))) {
    if (selected.some((range) => candidate.start < range.end && candidate.end > range.start)) continue;
    selected.push(candidate);
  }
  return selected.sort((a, b) => b.start - a.start);
}

export function protectUnsupportedMarkdown(source: string): string {
  if (!source) return source;
  const ranges: ProtectedRange[] = [];

  addRegexRanges(source, /^(:{3,})[^\n]*\n[\s\S]*?^\1[ \t]*(?=\n|$)/gm, "block", 100, ranges);
  addRegexRanges(source, /^\[toc\][ \t]*(?=\n|$)/gim, "block", 95, ranges);
  addRegexRanges(source, /^\[\^[^\]\n]+\]:[^\n]*(?:\n(?: {2,}|\t)[^\n]*)*/gm, "block", 90, ranges);
  collectHtmlRanges(source, parser.parse(source) as PositionedNode, null, ranges);
  addRegexRanges(source, /\[\^[^\]\n]+\]/g, "inline", 60, ranges);

  let protectedSource = source;
  for (const range of selectNonOverlappingRanges(ranges)) {
    const raw = source.slice(range.start, range.end);
    const sentinel = `<!--yuling-internal-raw-${range.kind}:${encodeRaw(raw)}-->`;
    protectedSource = `${protectedSource.slice(0, range.start)}${sentinel}${protectedSource.slice(range.end)}`;
  }
  return protectedSource;
}

function renderTableOfContents(dom: HTMLElement, view: EditorView) {
  dom.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = "目录";
  dom.append(title);
  const list = document.createElement("ol");
  view.state.doc.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    const item = document.createElement("li");
    item.style.marginLeft = `${Math.max(0, Number(node.attrs.level ?? 1) - 1) * 14}px`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = node.textContent || "未命名标题";
    button.addEventListener("click", () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(position + 1))));
      view.focus();
    });
    item.append(button);
    list.append(item);
  });
  dom.append(list);
}

function rawNodeView(kind: "block" | "inline") {
  return ({ node, view }: { node: { attrs: { raw?: string } }; view: EditorView }) => {
    const raw = node.attrs.raw ?? "";
    if (kind === "block" && /^\[toc\]\s*$/i.test(raw)) {
      const dom = document.createElement("nav");
      dom.className = "yuling-table-of-contents";
      dom.dataset.yulingToc = "true";
      dom.contentEditable = "false";
      renderTableOfContents(dom, view);
      return { dom };
    }

    const footnoteReference = /^\[\^([^\]\n]+)\]$/.exec(raw);
    const footnoteDefinition = /^\[\^([^\]\n]+)\]:\s*([\s\S]*)$/.exec(raw);
    const dom = document.createElement(kind === "block" ? "pre" : "span");
    dom.className = `yuling-raw-markdown yuling-raw-markdown-${kind}`;
    dom.dataset.yulingRawMarkdown = kind;
    dom.contentEditable = "false";
    if (footnoteReference) {
      dom.className = "yuling-footnote-reference";
      dom.textContent = footnoteReference[1];
      dom.setAttribute("aria-label", `脚注 ${footnoteReference[1]}`);
    } else if (footnoteDefinition) {
      dom.className = "yuling-footnote-definition";
      const label = document.createElement("sup");
      label.textContent = footnoteDefinition[1];
      const content = document.createElement("span");
      content.textContent = footnoteDefinition[2].replace(/\n(?: {2,}|\t)/g, "\n");
      dom.replaceChildren(label, content);
    } else {
      dom.textContent = raw;
    }
    return { dom };
  };
}

export const RawMarkdownPreview = Extension.create({
  name: "rawMarkdownPreview",
  addProseMirrorPlugins() {
    return [new Plugin({
      view: (view) => ({
        update: (updatedView) => {
          updatedView.dom.querySelectorAll<HTMLElement>("[data-yuling-toc]")
            .forEach((dom) => renderTableOfContents(dom, updatedView));
        },
      }),
    })];
  },
});

export const RawMarkdownBlock = Node.create({
  name: "yulingRawMarkdownBlock",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-yuling-raw-markdown="block"]' }];
  },
  renderHTML({ node }) {
    return ["pre", { "data-yuling-raw-markdown": "block", contenteditable: "false" }, node.attrs.raw];
  },
  addNodeView() {
    return rawNodeView("block");
  },
  markdownTokenName: "yulingRawMarkdownBlock",
  markdownTokenizer: {
    name: "yulingRawMarkdownBlock",
    level: "block",
    start: (source: string) => source.indexOf("<!--yuling-internal-raw-block:"),
    tokenize(source: string) {
      const match = blockSentinelPattern.exec(source);
      return match ? { type: "yulingRawMarkdownBlock", raw: match[0], protectedRaw: decodeRaw(match[1]) } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("yulingRawMarkdownBlock", { raw: token.protectedRaw }),
  renderMarkdown: (node) => node.attrs?.raw ?? "",
});

export const RawMarkdownInline = Node.create({
  name: "yulingRawMarkdownInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { raw: { default: "" } };
  },
  parseHTML() {
    return [{ tag: 'span[data-yuling-raw-markdown="inline"]' }];
  },
  renderHTML({ node }) {
    return ["span", { "data-yuling-raw-markdown": "inline", contenteditable: "false" }, node.attrs.raw];
  },
  addNodeView() {
    return rawNodeView("inline");
  },
  markdownTokenName: "yulingRawMarkdownInline",
  markdownTokenizer: {
    name: "yulingRawMarkdownInline",
    level: "inline",
    start: (source: string) => source.indexOf("<!--yuling-internal-raw-inline:"),
    tokenize(source: string) {
      const match = inlineSentinelPattern.exec(source);
      return match ? { type: "yulingRawMarkdownInline", raw: match[0], protectedRaw: decodeRaw(match[1]) } : undefined;
    },
  },
  parseMarkdown: (token, helpers) => helpers.createNode("yulingRawMarkdownInline", { raw: token.protectedRaw }),
  renderMarkdown: (node) => node.attrs?.raw ?? "",
});
