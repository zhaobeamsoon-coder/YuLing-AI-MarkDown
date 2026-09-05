import type { Editor, JSONContent } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";

function selectionDocument(editor: Editor): JSONContent {
  if (editor.state.selection.empty) return editor.getJSON();
  return { type: "doc", content: editor.state.selection.content().content.toJSON() as JSONContent[] };
}

export function selectedMarkdown(editor: Editor): string {
  return editor.storage.markdown.manager.serialize(selectionDocument(editor)).trim();
}

export function selectedHtml(editor: Editor): string {
  const content = editor.state.selection.empty ? editor.state.doc.content : editor.state.selection.content().content;
  const container = document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(content));
  return container.innerHTML;
}
