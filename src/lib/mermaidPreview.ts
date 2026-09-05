import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

let previewSequence = 0;
const mermaidPreviewKey = new PluginKey<DecorationSet>("mermaidPreview");
let mermaidLoader: Promise<(typeof import("mermaid"))["default"]> | null = null;

function loadMermaid() {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
    return mermaid;
  });
  return mermaidLoader;
}

function previewElement(source: string): HTMLElement {
  const element = document.createElement("div");
  element.className = "mermaid-preview";
  element.contentEditable = "false";
  element.setAttribute("aria-label", "Mermaid 图表预览");
  const id = `yuling-mermaid-editor-${previewSequence += 1}`;
  void loadMermaid().then((mermaid) => mermaid.render(id, source)).then(
    ({ svg }) => { element.innerHTML = svg; },
    () => {
      element.classList.add("mermaid-preview-error");
      element.textContent = "图表语法有误，请修改上方代码。";
    },
  );
  return element;
}

function mermaidDecorations(document: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  document.descendants((node, position) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
      decorations.push(Decoration.widget(position + node.nodeSize, () => previewElement(node.textContent), {
        key: `mermaid-${position}-${node.textContent}`,
        side: -1,
      }));
    }
  });
  return DecorationSet.create(document, decorations);
}

export const MermaidPreview = Extension.create({
  name: "mermaidPreview",

  addProseMirrorPlugins() {
    return [new Plugin({
      key: mermaidPreviewKey,
      state: {
        init: (_, state) => mermaidDecorations(state.doc),
        apply: (transaction) => mermaidDecorations(transaction.doc),
      },
      props: {
        decorations: (state) => mermaidPreviewKey.getState(state) ?? null,
      },
    })];
  },
});
