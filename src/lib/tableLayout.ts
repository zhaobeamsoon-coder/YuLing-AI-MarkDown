export interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
}

export interface TableLayout {
  anchor: string;
  widths: number[];
}

export interface WorkspaceLayout {
  version: 2;
  documents: Record<string, TableLayout[]>;
  images: Record<string, ImageLayout[]>;
}

export interface ImageLayout {
  key: string;
  width: number;
}

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const documents = candidate.documents && typeof candidate.documents === "object"
    ? candidate.documents as Record<string, TableLayout[]> : {};
  const images = candidate.version === 2 && candidate.images && typeof candidate.images === "object"
    ? candidate.images as Record<string, ImageLayout[]> : {};
  return { version: 2, documents, images };
}

function textContent(node: TiptapNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textContent).join("");
}

export function extractTableLayouts(document: TiptapNode): TableLayout[] {
  const layouts: TableLayout[] = [];
  let section = "root";
  let ordinal = 0;
  for (const node of document.content ?? []) {
    if (node.type === "heading") {
      section = textContent(node).trim() || "untitled";
      ordinal = 0;
      continue;
    }
    if (node.type !== "table") continue;
    const firstRow = node.content?.[0];
    const widths = (firstRow?.content ?? []).map((cell) => {
      const colwidth = cell.attrs?.colwidth;
      return Array.isArray(colwidth) && typeof colwidth[0] === "number" ? colwidth[0] : 140;
    });
    layouts.push({ anchor: `${section}#${ordinal}`, widths });
    ordinal += 1;
  }
  return layouts;
}

export function applyTableLayouts(document: TiptapNode, layouts: TableLayout[]): TiptapNode {
  const restored = structuredClone(document);
  const byAnchor = new Map(layouts.map((layout) => [layout.anchor, layout.widths]));
  let section = "root";
  let ordinal = 0;
  for (const node of restored.content ?? []) {
    if (node.type === "heading") {
      section = textContent(node).trim() || "untitled";
      ordinal = 0;
      continue;
    }
    if (node.type !== "table") continue;
    const widths = byAnchor.get(`${section}#${ordinal}`);
    ordinal += 1;
    if (!widths?.length) continue;
    for (const row of node.content ?? []) {
      let column = 0;
      for (const cell of row.content ?? []) {
        const colspan = typeof cell.attrs?.colspan === "number" ? cell.attrs.colspan : 1;
        const cellWidths = widths.slice(column, column + colspan);
        column += colspan;
        if (cellWidths.length !== colspan) continue;
        cell.attrs = { ...cell.attrs, colwidth: cellWidths };
      }
    }
  }
  return restored;
}

function visitImages(node: TiptapNode, callback: (image: TiptapNode, key: string) => void, occurrences = new Map<string, number>()): void {
  if (node.type === "image") {
    const source = String(node.attrs?.markdownSrc ?? node.attrs?.src ?? "");
    const occurrence = occurrences.get(source) ?? 0;
    occurrences.set(source, occurrence + 1);
    callback(node, `${source}#${occurrence}`);
  }
  for (const child of node.content ?? []) visitImages(child, callback, occurrences);
}

export function extractImageLayouts(document: TiptapNode): ImageLayout[] {
  const layouts: ImageLayout[] = [];
  visitImages(document, (image, key) => {
    const width = image.attrs?.displayWidth;
    if (typeof width === "number" && width >= 80) layouts.push({ key, width: Math.round(width) });
  });
  return layouts;
}

export function applyImageLayouts(document: TiptapNode, layouts: ImageLayout[]): TiptapNode {
  const restored = structuredClone(document);
  const byKey = new Map(layouts.map((layout) => [layout.key, layout.width]));
  visitImages(restored, (image, key) => {
    const width = byKey.get(key);
    if (width) image.attrs = { ...image.attrs, displayWidth: width };
  });
  return restored;
}
