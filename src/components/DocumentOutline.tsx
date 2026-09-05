import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { activeOutlineIndex, extractDocumentOutline } from "../lib/outline";

interface DocumentOutlineProps {
  editor: Editor;
  onClose: () => void;
}

export function DocumentOutline({ editor, onClose }: DocumentOutlineProps) {
  const outline = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const headings = currentEditor ? extractDocumentOutline(currentEditor.state.doc) : [];
      const selectionPosition = currentEditor?.state.selection.from ?? 0;
      return { headings, activeIndex: activeOutlineIndex(headings, selectionPosition) };
    },
  });

  return (
    <nav className="document-outline" aria-label="文档大纲">
      <header>
        <strong>大纲</strong>
        <button aria-label="关闭大纲" onClick={onClose}>×</button>
      </header>
      <div className="outline-items">
        {!outline?.headings.length && <p>当前文档没有标题</p>}
        {outline?.headings.map((heading, index) => (
          <button
            key={`${heading.position}-${heading.text}`}
            className="outline-item"
            style={{ paddingLeft: 10 + (heading.level - 1) * 12 }}
            aria-current={index === outline.activeIndex ? "location" : undefined}
            onClick={() => {
              editor.chain()
                .focus()
                .setTextSelection(Math.min(heading.position + 1, editor.state.doc.content.size))
                .scrollIntoView()
                .run();
            }}
          >
            <span>{heading.text}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
