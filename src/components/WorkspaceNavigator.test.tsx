// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchWorkspace = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ searchWorkspace }));

import { WorkspaceNavigator } from "./WorkspaceNavigator";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const documents = [
  { path: "/资料库/项目/苹果.md", relativePath: "项目/苹果.md", title: "苹果", modifiedMs: 1 },
  { path: "/资料库/香蕉.md", relativePath: "香蕉.md", title: "香蕉", modifiedMs: 2 },
];

describe("WorkspaceNavigator", () => {
  it("quickly filters document paths and opens the selected document", () => {
    const onOpen = vi.fn();
    render(<WorkspaceNavigator mode="quick" workspace="/资料库" documents={documents} onOpen={onOpen} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "快速打开文档" }), { target: { value: "项目" } });
    fireEvent.click(screen.getByRole("button", { name: /项目\/苹果.md/ }));

    expect(onOpen).toHaveBeenCalledWith("/资料库/项目/苹果.md");
  });

  it("shows workspace full-text results with excerpts", async () => {
    searchWorkspace.mockResolvedValue([{
      path: "/资料库/香蕉.md", title: "香蕉", excerpt: "这里命中了关键词", score: 1,
    }]);
    render(<WorkspaceNavigator mode="search" workspace="/资料库" documents={documents} onOpen={vi.fn()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: "全文搜索" }), { target: { value: "关键词" } });

    expect(await screen.findByText("这里命中了关键词")).toBeTruthy();
    await waitFor(() => expect(searchWorkspace).toHaveBeenCalledWith("/资料库", "关键词", 30));
  });
});
