import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type OutlineLevel = 1 | 2 | 3 | 4 | 5 | 6;

export interface OutlineHeading {
  level: OutlineLevel;
  text: string;
  position: number;
}

export function extractDocumentOutline(document: ProseMirrorNode): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  document.descendants((node, position) => {
    if (node.type.name !== "heading") return;
    const level = Number(node.attrs.level);
    if (level < 1 || level > 6) return;
    headings.push({
      level: level as OutlineLevel,
      text: node.textContent.trim() || "未命名标题",
      position,
    });
  });
  return headings;
}

export function activeOutlineIndex(headings: OutlineHeading[], selectionPosition: number): number {
  let active = headings.length ? 0 : -1;
  headings.forEach((heading, index) => {
    if (heading.position <= selectionPosition) active = index;
  });
  return active;
}
