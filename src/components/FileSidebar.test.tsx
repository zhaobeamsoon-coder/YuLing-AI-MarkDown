// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentEntry } from "../lib/api";
import { FileSidebar } from "./FileSidebar";

afterEach(cleanup);

function document(relativePath: string): DocumentEntry {
  return {
    path: `/资料库/${relativePath}`,
    relativePath,
    title: relativePath.split("/").at(-1)!.replace(/\.md$/i, ""),
    modifiedMs: 1,
  };
}

describe("FileSidebar blank document location", () => {
  it("creates in the active document parent and can switch back to the root", async () => {
    const onCreateDocument = vi.fn();
    render(
      <FileSidebar
        workspace="/资料库"
        documents={[document("项目/二级/笔记.md")]}
        activePath="/资料库/项目/二级/笔记.md"
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={onCreateDocument}
        onRenameDocument={vi.fn()}
        onMoveDocument={vi.fn()}
        onTrashDocument={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText("新建位置：项目/二级")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "新建文档" }));
    expect(onCreateDocument).toHaveBeenLastCalledWith("项目/二级");

    fireEvent.click(screen.getByRole("button", { name: "资料库" }));
    expect(screen.getByText("新建位置：文档库根目录")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建文档" }));
    expect(onCreateDocument).toHaveBeenLastCalledWith("");
  });

  it("uses one identically sized chevron and rotates it for collapse", () => {
    const { container } = render(
      <FileSidebar
        workspace="/资料库"
        documents={[document("项目/笔记.md")]}
        activePath={null}
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onRenameDocument={vi.fn()}
        onMoveDocument={vi.fn()}
        onTrashDocument={vi.fn()}
      />,
    );

    expect(container.querySelectorAll(".sidebar-action-chevron")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "展开全部目录" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "展开全部目录" }));
    expect(screen.getByRole("button", { name: "折叠全部目录" })).toBeTruthy();
  });

  it("uses clear document and folder actions with inline folder creation", async () => {
    const onCreateFolder = vi.fn().mockResolvedValueOnce("名称已存在").mockResolvedValueOnce(null);
    render(
      <FileSidebar
        workspace="/资料库"
        documents={[document("项目/笔记.md")]}
        activePath="/资料库/项目/笔记.md"
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onRenameDocument={vi.fn()}
        onMoveDocument={vi.fn()}
        onTrashDocument={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    );

    expect((await screen.findByRole("button", { name: "新建文档" })).textContent).toContain("文档");
    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "资料" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((await screen.findByRole("alert")).textContent).toContain("名称已存在");
    expect(screen.getByRole("textbox", { name: "文件夹名称" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "确认新建文件夹" }));
    await waitFor(() => expect(onCreateFolder).toHaveBeenLastCalledWith("项目", "资料"));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "文件夹名称" })).toBeNull());
    expect(screen.getByText("新建位置：项目/资料")).toBeTruthy();
  });

  it("rejects invalid folder names and cancels the inline editor with Escape", () => {
    const onCreateFolder = vi.fn();
    render(
      <FileSidebar
        workspace="/资料库"
        documents={[]}
        activePath={null}
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onRenameDocument={vi.fn()}
        onMoveDocument={vi.fn()}
        onTrashDocument={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));
    const input = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(input, { target: { value: "../资料" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toContain("路径符号");
    expect(onCreateFolder).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "文件夹名称" })).toBeNull();
  });

  it("renames, moves, and confirms trash from the file context menu", async () => {
    const entry = document("项目/笔记.md");
    const onRenameDocument = vi.fn();
    const onMoveDocument = vi.fn();
    const onTrashDocument = vi.fn();
    render(
      <FileSidebar
        workspace="/资料库"
        documents={[entry, document("归档/文档.md")]}
        activePath={entry.path}
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onRenameDocument={onRenameDocument}
        onMoveDocument={onMoveDocument}
        onTrashDocument={onTrashDocument}
      />,
    );

    fireEvent.contextMenu(screen.getByTitle("项目/笔记.md"), { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "重命名文档" });
    fireEvent.change(input, { target: { value: "新名字" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameDocument).toHaveBeenCalledWith(entry, "新名字");

    fireEvent.contextMenu(screen.getByTitle("项目/笔记.md"), { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "移动到" }));
    fireEvent.click(screen.getByRole("button", { name: "移动到 归档" }));
    expect(onMoveDocument).toHaveBeenCalledWith(entry, "归档");

    fireEvent.contextMenu(screen.getByTitle("项目/笔记.md"), { clientX: 40, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "移入废纸篓" }));
    expect(onTrashDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移入废纸篓" }));
    expect(onTrashDocument).toHaveBeenCalledWith(entry);
  });

  it("moves a dragged file to a folder or the workspace root", () => {
    const entry = document("项目/笔记.md");
    const onMoveDocument = vi.fn();
    render(
      <FileSidebar
        workspace="/资料库"
        documents={[entry, document("归档/文档.md")]}
        activePath={entry.path}
        search=""
        onSearch={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onOpenDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onRenameDocument={vi.fn()}
        onMoveDocument={onMoveDocument}
        onTrashDocument={vi.fn()}
      />,
    );

    const file = screen.getByTitle("项目/笔记.md");
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => entry.relativePath), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(file, { dataTransfer });
    fireEvent.drop(screen.getByRole("button", { name: /归档/ }), { dataTransfer });
    expect(onMoveDocument).toHaveBeenCalledWith(entry, "归档");
    fireEvent.drop(screen.getByRole("button", { name: "资料库" }), { dataTransfer });
    expect(onMoveDocument).toHaveBeenCalledWith(entry, "");
  });
});
