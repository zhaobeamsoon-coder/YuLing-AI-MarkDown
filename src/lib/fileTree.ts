import type { DocumentEntry } from "./api";

export interface DocumentTreeFolder {
  kind: "folder";
  name: string;
  relativePath: string;
  children: DocumentTreeNode[];
}

export interface DocumentTreeFile {
  kind: "file";
  name: string;
  relativePath: string;
  document: DocumentEntry;
}

export type DocumentTreeNode = DocumentTreeFolder | DocumentTreeFile;
export type DocumentSort = "name-asc" | "name-desc" | "modified-desc" | "modified-asc";

function sortNodes(nodes: DocumentTreeNode[], sort: DocumentSort): DocumentTreeNode[] {
  return nodes
    .map((node) => node.kind === "folder" ? { ...node, children: sortNodes(node.children, sort) } : node)
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      if (left.kind === "file" && right.kind === "file" && sort.startsWith("modified")) {
        const difference = left.document.modifiedMs - right.document.modifiedMs;
        if (difference) return sort === "modified-desc" ? -difference : difference;
      }
      const nameOrder = left.name.localeCompare(right.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
      return sort === "name-desc" ? -nameOrder : nameOrder;
    });
}

export function buildDocumentTree(documents: DocumentEntry[], directoryPaths: string[] = [], sort: DocumentSort = "name-asc"): DocumentTreeNode[] {
  const root: DocumentTreeFolder = { kind: "folder", name: "", relativePath: "", children: [] };
  const folders = new Map<string, DocumentTreeFolder>([["", root]]);

  for (const directoryPath of [...directoryPaths].sort((left, right) => left.localeCompare(right))) {
    const parts = directoryPath.split("/").filter(Boolean);
    let parent = root;
    parts.forEach((name, index) => {
      const relativePath = parts.slice(0, index + 1).join("/");
      let folder = folders.get(relativePath);
      if (!folder) {
        folder = { kind: "folder", name, relativePath, children: [] };
        folders.set(relativePath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    });
  }

  for (const document of documents) {
    const parts = document.relativePath.split("/").filter(Boolean);
    let parent = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const relativePath = parts.slice(0, index + 1).join("/");
      let folder = folders.get(relativePath);
      if (!folder) {
        folder = { kind: "folder", name: parts[index], relativePath, children: [] };
        folders.set(relativePath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({
      kind: "file",
      name: parts.at(-1)?.replace(/\.md$/i, "") || document.title,
      relativePath: document.relativePath,
      document,
    });
  }

  return sortNodes(root.children, sort);
}

export function folderAncestors(relativePath: string): string[] {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function parentFolder(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.slice(0, -1).join("/");
}

export function nextUntitledDocumentPath(documents: DocumentEntry[], folder: string): string {
  const normalizedFolder = folder.split("/").filter(Boolean).join("/");
  const existing = new Set(documents.map((document) => document.relativePath.toLocaleLowerCase()));
  let suffix = 1;
  while (true) {
    const name = suffix === 1 ? "未命名.md" : `未命名 ${suffix}.md`;
    const candidate = normalizedFolder ? `${normalizedFolder}/${name}` : name;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
    suffix += 1;
  }
}

export function nextDuplicateDocumentPath(documents: DocumentEntry[], source: DocumentEntry): string {
  const folder = parentFolder(source.relativePath);
  const existing = new Set(documents.map((document) => document.relativePath.toLocaleLowerCase()));
  let suffix = 1;
  while (true) {
    const copyName = suffix === 1 ? `${source.title} 副本.md` : `${source.title} 副本 ${suffix}.md`;
    const candidate = folder ? `${folder}/${copyName}` : copyName;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
    suffix += 1;
  }
}

export function folderPaths(nodes: DocumentTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "folder"
    ? [node.relativePath, ...folderPaths(node.children)]
    : []);
}
