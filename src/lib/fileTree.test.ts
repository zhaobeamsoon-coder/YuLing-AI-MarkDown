import { describe, expect, it } from "vitest";
import type { DocumentEntry } from "./api";
import { buildDocumentTree, folderAncestors, folderPaths, nextDuplicateDocumentPath, nextUntitledDocumentPath, parentFolder } from "./fileTree";

function document(relativePath: string): DocumentEntry {
  return { path: `/资料/${relativePath}`, relativePath, title: relativePath.split("/").at(-1)!.replace(/\.md$/, ""), modifiedMs: 1 };
}

describe("document tree", () => {
  it("does not mutate the directory list supplied by React state", () => {
    const directories = ["B", "A"];

    buildDocumentTree([], directories);

    expect(directories).toEqual(["B", "A"]);
  });

  it("builds arbitrary nested folders and sorts folders before files", () => {
    const tree = buildDocumentTree([
      document("根文档.md"),
      document("项目/二级/深层文档.md"),
      document("项目/一级文档.md"),
      document("资料/另一篇.md"),
    ]);

    expect(tree.map((node) => [node.kind, node.name])).toEqual([
      ["folder", "项目"],
      ["folder", "资料"],
      ["file", "根文档"],
    ]);
    expect(folderPaths(tree)).toEqual(["项目", "项目/二级", "资料"]);
  });

  it("keeps empty workspace directories visible", () => {
    const tree = buildDocumentTree([], ["空目录", "项目/空子目录"]);
    expect(folderPaths(tree)).toEqual(["空目录", "项目", "项目/空子目录"]);
  });

  it("sorts files by modification time without moving folders below files", () => {
    const older = { ...document("旧文档.md"), modifiedMs: 10 };
    const newer = { ...document("新文档.md"), modifiedMs: 20 };
    const tree = buildDocumentTree([older, newer, document("目录/内容.md")], [], "modified-desc");
    expect(tree.map((node) => node.name)).toEqual(["目录", "新文档", "旧文档"]);
    expect(buildDocumentTree([older, newer], [], "modified-asc").map((node) => node.name)).toEqual(["旧文档", "新文档"]);
  });

  it("returns every parent needed to reveal an active document", () => {
    expect(folderAncestors("项目/二级/三级/文档.md")).toEqual(["项目", "项目/二级", "项目/二级/三级"]);
  });

  it("resolves the active file parent and the next blank document name", () => {
    const documents = [
      document("项目/未命名.md"),
      document("项目/未命名 2.md"),
      document("根文档.md"),
    ];

    expect(parentFolder("项目/二级/文档.md")).toBe("项目/二级");
    expect(parentFolder("根文档.md")).toBe("");
    expect(nextUntitledDocumentPath(documents, "项目")).toBe("项目/未命名 3.md");
    expect(nextUntitledDocumentPath(documents, "")).toBe("未命名.md");
  });
});

describe("nextDuplicateDocumentPath", () => {
  it("creates a non-conflicting copy beside the source", () => {
    const documents = [document("项目/原文.md"), document("项目/原文 副本.md")];
    expect(nextDuplicateDocumentPath(documents, documents[0])).toBe("项目/原文 副本 2.md");
  });
});
