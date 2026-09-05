// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiChatRequest, KnowledgeCardInput, SearchResult } from "../lib/api";
import { AiPanel } from "./AiPanel";

const mocks = vi.hoisted(() => ({
  cancelAiChat: vi.fn(async () => true),
  chooseCliExecutable: vi.fn(async () => "/opt/homebrew/bin/codex"),
  listen: vi.fn(),
  probeAiCli: vi.fn(async (kind: string) => ({
    kind,
    resolvedPath: kind === "claude-cli" ? "/Users/test/.local/bin/claude" : "/opt/homebrew/bin/codex",
    version: kind === "claude-cli" ? "2.1.0 (Claude Code)" : "codex-cli 1.0",
    attempts: [],
  })),
  runningInTauri: vi.fn(() => true),
  saveCredential: vi.fn(),
  saveKnowledgeCard: vi.fn<(workspace: string, card: KnowledgeCardInput) => Promise<string>>(async () => "/资料库/知识卡片/卡片.md"),
  searchWorkspace: vi.fn<(workspace: string, query: string, limit: number) => Promise<SearchResult[]>>(async () => []),
  startAiChat: vi.fn<(request: AiChatRequest) => Promise<void>>(async () => undefined),
  testAiConnection: vi.fn(async () => ({ ok: true, message: "连接和模型检查通过" })),
  streamHandler: undefined as ((event: { payload: { requestId: string; kind: string; text: string; errorKind?: string } }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("../lib/api", () => ({
  cancelAiChat: mocks.cancelAiChat,
  chooseCliExecutable: mocks.chooseCliExecutable,
  probeAiCli: mocks.probeAiCli,
  runningInTauri: mocks.runningInTauri,
  saveCredential: mocks.saveCredential,
  saveKnowledgeCard: mocks.saveKnowledgeCard,
  searchWorkspace: mocks.searchWorkspace,
  startAiChat: mocks.startAiChat,
  testAiConnection: mocks.testAiConnection,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.streamHandler = undefined;
  mocks.listen.mockImplementation(async (_event, handler) => {
    mocks.streamHandler = handler;
    return () => undefined;
  });
});

afterEach(cleanup);

function panel(
  selection: string,
  specialSelectionMode: "visible" | "markdown" = "visible",
  onSpecialSelectionModeChange = vi.fn(),
  taskVersion = 0,
) {
  return (
    <AiPanel
      workspace="/资料库"
      documentPath="/资料库/正文.md"
      documentMarkdown="# 正文"
      selection={selection}
      taskVersion={taskVersion}
      specialSelectionMode={specialSelectionMode}
      onSpecialSelectionModeChange={onSpecialSelectionModeChange}
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
    />
  );
}

describe("AiPanel editable prompt", () => {
  it("changes the special-content selection mode from settings", () => {
    const onChange = vi.fn();
    render(panel("问题", "visible", onChange));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(screen.getByRole("combobox", { name: "特殊内容划词" }), { target: { value: "markdown" } });

    expect(onChange).toHaveBeenCalledWith("markdown");
  });

  it("keeps the current task until a submitted selection advances the task version", async () => {
    mocks.searchWorkspace.mockResolvedValueOnce([{
      path: "/资料库/关联.md", title: "关联", excerpt: "关联摘录", score: 1,
    }]);
    const { rerender } = render(panel("原始选区"));
    const prompt = screen.getByRole("textbox", { name: "向知了提问" });
    expect((prompt as HTMLTextAreaElement).value).toBe("原始选区");

    fireEvent.change(prompt, { target: { value: "修改后的问题，并补充这一点" } });
    fireEvent.click(screen.getByRole("button", { name: "解释" }));

    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(1));
    expect(mocks.searchWorkspace).toHaveBeenCalledWith("/资料库", "修改后的问题，并补充这一点", 6);
    expect(mocks.startAiChat.mock.calls[0]![0].messages[1]!.content).toContain("修改后的问题，并补充这一点");
    const requestId = mocks.startAiChat.mock.calls[0]![0].requestId;
    act(() => mocks.streamHandler?.({ payload: { requestId, kind: "token", text: "旧回答" } }));
    expect(await screen.findByText("旧回答")).toBeTruthy();
    expect(screen.getByText("关联摘录")).toBeTruthy();

    rerender(panel("普通新选区", "visible", vi.fn(), 0));
    expect((screen.getByRole("textbox", { name: "向知了提问" }) as HTMLTextAreaElement).value).toBe("修改后的问题，并补充这一点");
    expect(screen.getByText("旧回答")).toBeTruthy();

    rerender(panel("正式提交的新选区", "visible", vi.fn(), 1));
    await waitFor(() => expect(mocks.cancelAiChat).toHaveBeenCalledWith(requestId));
    expect((screen.getByRole("textbox", { name: "向知了提问" }) as HTMLTextAreaElement).value).toBe("正式提交的新选区");
    expect(screen.queryByText("旧回答")).toBeNull();
    expect(screen.queryByText("关联摘录")).toBeNull();
    act(() => mocks.streamHandler?.({ payload: { requestId, kind: "token", text: "迟到回答" } }));
    expect(screen.queryByText("迟到回答")).toBeNull();
  });

  it("disables actions for an empty draft and keeps the original excerpt when saving a card", async () => {
    render(panel("不可改写的原始摘录"));
    const prompt = screen.getByRole("textbox", { name: "向知了提问" });
    fireEvent.change(prompt, { target: { value: "用于 AI 的修改稿" } });
    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(1));

    const requestId = mocks.startAiChat.mock.calls[0]![0].requestId;
    await waitFor(() => expect(mocks.streamHandler).toBeTypeOf("function"));
    act(() => mocks.streamHandler?.({ payload: { requestId, kind: "token", text: "回答" } }));
    fireEvent.click(await screen.findByRole("button", { name: "保存为知识卡片" }));
    await waitFor(() => expect(mocks.saveKnowledgeCard).toHaveBeenCalledTimes(1));
    expect(mocks.saveKnowledgeCard.mock.calls[0]![1]).toMatchObject({
      title: "用于 AI 的修改稿",
      sourceExcerpt: "不可改写的原始摘录",
    });

    fireEvent.change(prompt, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "解释" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops and resends the captured request without repeating retrieval", async () => {
    render(panel("原始选区"));
    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(1));
    const first = mocks.startAiChat.mock.calls[0]![0];

    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await waitFor(() => expect(mocks.cancelAiChat).toHaveBeenCalledWith(first.requestId));
    act(() => mocks.streamHandler?.({ payload: { requestId: first.requestId, kind: "cancelled", text: "已停止" } }));
    fireEvent.click(await screen.findByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(2));
    const retried = mocks.startAiChat.mock.calls[1]![0];
    expect(retried.requestId).not.toBe(first.requestId);
    expect(retried.messages).toEqual(first.messages);
    expect(mocks.searchWorkspace).toHaveBeenCalledTimes(1);
  });

  it("shows a recovery action for a missing model and tests the configured connection", async () => {
    render(panel("问题"));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByText("✓ 连接和模型检查通过")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(1));
    const requestId = mocks.startAiChat.mock.calls[0]![0].requestId;
    act(() => mocks.streamHandler?.({ payload: { requestId, kind: "error", text: "没有模型", errorKind: "model_missing" } }));
    expect(await screen.findByText(/改用服务已安装或已授权的模型/)).toBeTruthy();
  });

  it("detects Codex CLI and preserves its safe request context when resending", async () => {
    render(panel("本地 CLI 问题"));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(screen.getByRole("combobox", { name: "服务" }), { target: { value: "codex-cli" } });

    await waitFor(() => expect(mocks.probeAiCli).toHaveBeenCalledWith("codex-cli", undefined, false));
    expect(await screen.findByDisplayValue("/opt/homebrew/bin/codex")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "地址" })).toBeNull();
    expect(screen.getByText(/不会调用模型或消耗额度/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "解释" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(1));
    const first = mocks.startAiChat.mock.calls[0]![0];
    expect(first).toMatchObject({
      provider: "codex-cli",
      cliPath: "/opt/homebrew/bin/codex",
      workspace: "/资料库",
    });

    act(() => mocks.streamHandler?.({ payload: { requestId: first.requestId, kind: "error", text: "login required", errorKind: "cli_not_authenticated" } }));
    expect(await screen.findByText(/终端完成该 CLI 的本地登录/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重新发送" }));
    await waitFor(() => expect(mocks.startAiChat).toHaveBeenCalledTimes(2));
    expect(mocks.startAiChat.mock.calls[1]![0]).toMatchObject({
      provider: "codex-cli",
      cliPath: first.cliPath,
      workspace: first.workspace,
      messages: first.messages,
    });
  });

  it("validates a manually selected Claude executable without falling back", async () => {
    mocks.chooseCliExecutable.mockResolvedValueOnce("/chosen/claude");
    render(panel("问题"));
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.change(screen.getByRole("combobox", { name: "服务" }), { target: { value: "claude-cli" } });
    await waitFor(() => expect(mocks.probeAiCli).toHaveBeenCalled());
    mocks.probeAiCli.mockResolvedValueOnce({
      kind: "claude-cli",
      resolvedPath: "/chosen/claude",
      version: "2.1.0 (Claude Code)",
      attempts: [],
    });
    fireEvent.click(screen.getByRole("button", { name: "选择可执行文件" }));
    await waitFor(() => expect(mocks.probeAiCli).toHaveBeenLastCalledWith("claude-cli", "/chosen/claude", true));
  });
});
