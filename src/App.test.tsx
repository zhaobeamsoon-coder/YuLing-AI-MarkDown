// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  chooseWorkspace: vi.fn(),
  authorizeWorkspace: vi.fn(),
  listDocuments: vi.fn(),
  readDocument: vi.fn(),
  reindexWorkspace: vi.fn(),
  chooseMarkdownFile: vi.fn(),
  chooseMarkdownSavePath: vi.fn(),
  listDirectories: vi.fn(async () => [] as string[]),
  watchWorkspace: vi.fn(),
  cancelAiChat: vi.fn(async () => true),
  searchWorkspace: vi.fn(async () => []),
  startAiChat: vi.fn(async () => undefined),
  takeOpenedMarkdown: vi.fn<() => Promise<Array<{ workspace: string; path: string }>>>(async () => []),
  onOpenedMarkdown: vi.fn<(listener: () => void) => Promise<() => void>>(async () => () => undefined),
}));

vi.mock("./lib/api", () => ({
  ...api,
  createDocument: vi.fn(),
  loadLayout: vi.fn(async () => '{"version":1,"documents":{}}'),
  moveDocument: vi.fn(),
  saveLayout: vi.fn(),
  trashDocument: vi.fn(),
  writeDocument: vi.fn(),
  writeMarkdownCopy: vi.fn(),
  duplicateDocument: vi.fn(),
  revealDocumentInFinder: vi.fn(),
  copyPlainText: vi.fn(),
  runningInTauri: vi.fn(() => false),
  cancelAiChat: api.cancelAiChat,
  chooseCliExecutable: vi.fn(),
  probeAiCli: vi.fn(),
  saveCredential: vi.fn(),
  saveKnowledgeCard: vi.fn(),
  searchWorkspace: api.searchWorkspace,
  startAiChat: api.startAiChat,
  testAiConnection: vi.fn(),
  listDirectories: api.listDirectories,
  watchWorkspace: api.watchWorkspace,
  createDirectory: vi.fn(),
  moveDirectory: vi.fn(),
  trashDirectory: vi.fn(),
}));

import App from "./App";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("workspace opening", () => {
  it("shows an externally created Markdown file after the workspace watcher fires", async () => {
    let watched: ((event: { type: unknown; paths: string[]; attrs: unknown }) => void) | undefined;
    api.watchWorkspace.mockImplementation(async (_workspace, callback) => {
      watched = callback;
      return () => undefined;
    });
    api.chooseWorkspace.mockResolvedValue("/资料库");
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments
      .mockResolvedValueOnce([{ path: "/资料库/A.md", relativePath: "A.md", title: "A", modifiedMs: 1 }])
      .mockResolvedValue([{ path: "/资料库/A.md", relativePath: "A.md", title: "A", modifiedMs: 1 },
        { path: "/资料库/目录/B.md", relativePath: "目录/B.md", title: "B", modifiedMs: 2 }]);
    api.listDirectories.mockResolvedValueOnce([]).mockResolvedValue(["目录"]);
    api.reindexWorkspace.mockResolvedValue(2);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));
    expect(await screen.findByTitle("A.md")).toBeTruthy();
    await waitFor(() => expect(watched).toBeTypeOf("function"));
    watched?.({ type: { create: { kind: "file" } }, paths: ["/资料库/目录/B.md"], attrs: {} });

    fireEvent.click(await screen.findByRole("button", { name: "目录" }));
    expect(await screen.findByTitle("目录/B.md")).toBeTruthy();
    await waitFor(() => expect(api.reindexWorkspace).toHaveBeenCalledTimes(1), { timeout: 1_500 });

    api.reindexWorkspace.mockClear();
    const scansBeforeDuplicate = api.listDocuments.mock.calls.length;
    watched?.({ type: { create: { kind: "file" } }, paths: ["/资料库/目录/B.md"], attrs: {} });
    await waitFor(() => expect(api.listDocuments.mock.calls.length).toBeGreaterThan(scansBeforeDuplicate));
    await new Promise((resolve) => window.setTimeout(resolve, 700));
    expect(api.reindexWorkspace).not.toHaveBeenCalled();
  });

  it("keeps an open document when an external removal updates the sidebar", async () => {
    let watched: ((event: { type: unknown; paths: string[]; attrs: unknown }) => void) | undefined;
    api.watchWorkspace.mockImplementation(async (_workspace, callback) => {
      watched = callback;
      return () => undefined;
    });
    api.chooseWorkspace.mockResolvedValue("/资料库");
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments
      .mockResolvedValueOnce([{ path: "/资料库/A.md", relativePath: "A.md", title: "A", modifiedMs: 1 }])
      .mockResolvedValue([]);
    api.readDocument.mockResolvedValue({ content: "# 保留编辑内容", modifiedMs: 1 });
    api.reindexWorkspace.mockResolvedValue(0);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));
    fireEvent.click(await screen.findByTitle("A.md"));
    expect(await screen.findByRole("heading", { name: "保留编辑内容" })).toBeTruthy();
    await waitFor(() => expect(watched).toBeTypeOf("function"));
    watched?.({ type: { remove: { kind: "file" } }, paths: ["/资料库/A.md"], attrs: {} });

    await waitFor(() => expect(screen.queryByTitle("A.md")).toBeNull());
    expect(screen.getByRole("heading", { name: "保留编辑内容" })).toBeTruthy();
  });

  it("keeps Zhi Liao mounted when its persistent topbar entry hides and reopens it", async () => {
    api.chooseWorkspace.mockResolvedValue("/资料库");
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments.mockResolvedValue([
      { path: "/资料库/正文.md", relativePath: "正文.md", title: "正文", modifiedMs: 1 },
      { path: "/资料库/第二篇.md", relativePath: "第二篇.md", title: "第二篇", modifiedMs: 2 },
    ]);
    api.readDocument.mockImplementation(async (path: string) => ({
      content: path.endsWith("第二篇.md") ? "# 第二篇" : "# 正文",
      modifiedMs: path.endsWith("第二篇.md") ? 2 : 1,
    }));
    api.reindexWorkspace.mockResolvedValue(1);
    render(<App />);

    expect((screen.getByRole("button", { name: "知了" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));
    fireEvent.click(await screen.findByTitle("正文.md"));
    await screen.findByRole("heading", { name: "正文" });

    const openZhiLiao = screen.getByRole("button", { name: "知了" });
    expect((openZhiLiao as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(openZhiLiao);
    const prompt = screen.getByRole("textbox", { name: "向知了提问" });
    fireEvent.change(prompt, { target: { value: "保留的提问" } });
    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(api.startAiChat).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "关闭知了" }));
    expect(screen.queryByRole("textbox", { name: "向知了提问" })).toBeNull();
    expect(api.cancelAiChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("第二篇.md"));
    await screen.findByRole("heading", { name: "第二篇" });
    fireEvent.click(screen.getByRole("button", { name: "知了" }));
    expect((screen.getByRole("textbox", { name: "向知了提问" }) as HTMLTextAreaElement).value).toBe("保留的提问");
  });

  it("shows the library before a document is chosen and does not parse an arbitrary first file", async () => {
    api.chooseWorkspace.mockResolvedValue("/资料库");
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments.mockResolvedValue([{
      path: "/资料库/很大的第一篇.md",
      relativePath: "很大的第一篇.md",
      title: "很大的第一篇",
      modifiedMs: 1,
    }]);
    api.reindexWorkspace.mockResolvedValue(1);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));

    await screen.findByRole("heading", { name: "文档库已打开" });
    expect(screen.getByText("已找到 1 篇文档，请在左侧选择一篇。")).toBeTruthy();
    expect(screen.getByTitle("很大的第一篇.md")).toBeTruthy();
    expect(api.readDocument).not.toHaveBeenCalled();
  });

  it("surfaces a workspace scan failure instead of appearing to do nothing", async () => {
    api.chooseWorkspace.mockResolvedValue("/无权限资料库");
    api.authorizeWorkspace.mockRejectedValue(new Error("没有访问权限"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));

    await waitFor(() => expect(screen.getAllByText(/没有访问权限/)).toHaveLength(2));
    expect(screen.getByText(/无法打开文档库/)).toBeTruthy();
  });

  it("closes a tab and restores the most recently closed document", async () => {
    api.chooseWorkspace.mockResolvedValue("/资料库");
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments.mockResolvedValue([
      { path: "/资料库/A.md", relativePath: "A.md", title: "A", modifiedMs: 1 },
      { path: "/资料库/B.md", relativePath: "B.md", title: "B", modifiedMs: 2 },
    ]);
    api.readDocument.mockImplementation(async (path: string) => ({ content: `# ${path.endsWith("A.md") ? "A" : "B"}`, modifiedMs: path.endsWith("A.md") ? 1 : 2 }));
    api.reindexWorkspace.mockResolvedValue(2);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "打开 Markdown 文档库" }));
    fireEvent.click(await screen.findByTitle("A.md"));
    await screen.findByRole("heading", { name: "A" });
    fireEvent.click(screen.getByTitle("B.md"));
    await screen.findByRole("heading", { name: "B" });

    fireEvent.click(screen.getByRole("button", { name: "关闭 B" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "关闭 B" })).toBeNull());
    expect(screen.getByRole("heading", { name: "A" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "恢复关闭的标签" }));
    expect(await screen.findByRole("heading", { name: "B" })).toBeTruthy();
  });

  it("restores the last authorized workspace and tabs from disk", async () => {
    localStorage.setItem("yuling-md-session-v1", JSON.stringify({
      version: 1,
      workspace: "/资料库",
      tabs: ["恢复.md"],
      active: "恢复.md",
    }));
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments.mockResolvedValue([{
      path: "/资料库/恢复.md", relativePath: "恢复.md", title: "恢复", modifiedMs: 4,
    }]);
    api.readDocument.mockResolvedValue({ content: "# 已恢复", modifiedMs: 4 });
    api.reindexWorkspace.mockResolvedValue(1);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "已恢复" })).toBeTruthy();
    expect(api.authorizeWorkspace).toHaveBeenCalledWith("/资料库");
    expect(api.chooseWorkspace).not.toHaveBeenCalled();
  });

  it("keeps every crash draft until the user handles each one", async () => {
    localStorage.setItem("yuling-md-session-v1", JSON.stringify({
      version: 1,
      workspace: "/资料库",
      tabs: ["A.md", "B.md"],
      active: "A.md",
    }));
    localStorage.setItem("yuling-md-crash-drafts-v1", JSON.stringify([
      { workspace: "/资料库", path: "/资料库/A.md", relativePath: "A.md", content: "A 草稿", baseModifiedMs: 1, updatedAt: 20 },
      { workspace: "/资料库", path: "/资料库/B.md", relativePath: "B.md", content: "B 草稿", baseModifiedMs: 2, updatedAt: 10 },
    ]));
    api.authorizeWorkspace.mockResolvedValue("/资料库");
    api.listDocuments.mockResolvedValue([
      { path: "/资料库/A.md", relativePath: "A.md", title: "A", modifiedMs: 1 },
      { path: "/资料库/B.md", relativePath: "B.md", title: "B", modifiedMs: 2 },
    ]);
    api.readDocument.mockImplementation(async (path: string) => ({
      content: path.endsWith("A.md") ? "A 正文" : "B 正文",
      modifiedMs: path.endsWith("A.md") ? 1 : 2,
    }));
    api.reindexWorkspace.mockResolvedValue(2);

    render(<App />);

    expect(await screen.findByText(/发现“A”的未保存草稿/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("yuling-md-crash-drafts-v1") ?? "[]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "忽略" }));
    expect(await screen.findByText(/发现“B”的未保存草稿/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("yuling-md-crash-drafts-v1") ?? "[]")).toHaveLength(1);
  });

  it("keeps the current workspace when opening another Markdown file fails", async () => {
    let openedListener: (() => void) | undefined;
    api.onOpenedMarkdown.mockImplementation(async (listener: () => void) => {
      openedListener = listener;
      return () => undefined;
    });
    localStorage.setItem("yuling-md-session-v1", JSON.stringify({
      version: 1,
      workspace: "/原资料库",
      tabs: ["保留.md"],
      active: "保留.md",
    }));
    api.authorizeWorkspace.mockResolvedValue("/原资料库");
    api.listDocuments.mockImplementation(async (root: string) => root === "/原资料库"
      ? [{ path: "/原资料库/保留.md", relativePath: "保留.md", title: "保留", modifiedMs: 1 }]
      : [{ path: "/新资料库/失败.md", relativePath: "失败.md", title: "失败", modifiedMs: 2 }]);
    api.readDocument.mockImplementation(async (path: string) => {
      if (path === "/新资料库/失败.md") throw new Error("读取失败");
      return { content: "# 原文仍在", modifiedMs: 1 };
    });
    api.reindexWorkspace.mockResolvedValue(1);

    render(<App />);
    expect(await screen.findByRole("heading", { name: "原文仍在" })).toBeTruthy();
    api.takeOpenedMarkdown.mockResolvedValueOnce([{
      workspace: "/新资料库",
      path: "/新资料库/失败.md",
    }]);
    openedListener?.();

    await screen.findByText(/无法打开 Markdown 文档：.*读取失败/);
    expect(screen.getByRole("heading", { name: "原文仍在" })).toBeTruthy();
    expect(screen.getByTitle("保留.md")).toBeTruthy();
  });
});
