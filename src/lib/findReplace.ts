import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface TextMatch {
  from: number;
  to: number;
}

interface FindState {
  query: string;
  activeIndex: number;
}

const findPluginKey = new PluginKey<FindState>("yulingFindReplace");

function escapedPattern(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

export function findTextMatches(doc: ProseMirrorNode, query: string): TextMatch[] {
  if (!query) return [];
  const matches: TextMatch[] = [];
  const pattern = escapedPattern(query);
  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    const text = node.textBetween(0, node.content.size, "\n", "\ufffc");
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      matches.push({ from: position + 1 + match.index, to: position + 1 + match.index + match[0].length });
    }
  });
  return matches;
}

export function findStringMatches(text: string, query: string): TextMatch[] {
  if (!query) return [];
  return Array.from(text.matchAll(escapedPattern(query)), (match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }));
}

export function replaceStringMatches(text: string, matches: TextMatch[], replacement: string): string {
  let output = text;
  for (const match of [...matches].reverse()) {
    output = `${output.slice(0, match.from)}${replacement}${output.slice(match.to)}`;
  }
  return output;
}

function decorationsFor(doc: ProseMirrorNode, state: FindState): DecorationSet {
  const matches = findTextMatches(doc, state.query);
  return DecorationSet.create(doc, matches.map((match, index) => Decoration.inline(
    match.from,
    match.to,
    { class: index === state.activeIndex ? "yuling-find-match yuling-find-match-active" : "yuling-find-match" },
  )));
}

export const FindReplace = Extension.create({
  name: "yulingFindReplace",

  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findPluginKey,
      state: {
        init: () => ({ query: "", activeIndex: 0 }),
        apply(transaction, previous) {
          const next = transaction.getMeta(findPluginKey) as FindState | undefined;
          return next ?? previous;
        },
      },
      props: {
        decorations(state) {
          return decorationsFor(state.doc, findPluginKey.getState(state) ?? { query: "", activeIndex: 0 });
        },
      },
    })];
  },
});

export function showFindMatches(editor: Editor, query: string, activeIndex: number) {
  editor.view.dispatch(editor.state.tr.setMeta(findPluginKey, { query, activeIndex } satisfies FindState));
}

export function selectTextMatch(editor: Editor, match: TextMatch) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView());
}

export function replaceTextMatch(editor: Editor, match: TextMatch, replacement: string) {
  editor.view.dispatch(editor.state.tr.insertText(replacement, match.from, match.to).scrollIntoView());
}

export function replaceAllMatches(editor: Editor, matches: TextMatch[], replacement: string) {
  let transaction = editor.state.tr;
  for (const match of [...matches].reverse()) {
    transaction = transaction.insertText(replacement, match.from, match.to);
  }
  if (transaction.docChanged) editor.view.dispatch(transaction);
}
