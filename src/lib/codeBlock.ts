import type { Editor } from "@tiptap/core";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

export const HighlightedCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: 2,
});

export const codeLanguageOptions = [
  ["plaintext", "纯文本"],
  ["python", "Python"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["bash", "Bash / Shell"],
  ["json", "JSON"],
  ["yaml", "YAML"],
  ["markdown", "Markdown"],
  ["mermaid", "Mermaid 图表"],
  ["sql", "SQL"],
  ["rust", "Rust"],
  ["go", "Go"],
  ["java", "Java"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["swift", "Swift"],
  ["xml", "HTML / XML"],
  ["css", "CSS"],
] as const;

export function currentCodeBlockText(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "codeBlock") return node.textContent;
  }
  return null;
}
