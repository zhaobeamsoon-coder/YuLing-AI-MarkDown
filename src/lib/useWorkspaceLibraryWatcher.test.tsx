// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentEntry } from "./api";

const watcher = vi.hoisted(() => ({
  callback: undefined as ((event: { type: unknown; paths: string[]; attrs: unknown }) => void) | undefined,
  unwatch: vi.fn(),
  watchWorkspace: vi.fn(async (_workspace: string, callback: (event: { type: unknown; paths: string[]; attrs: unknown }) => void) => {
    watcher.callback = callback;
    return watcher.unwatch;
  }),
}));

vi.mock("./api", async (loadOriginal) => ({
  ...await loadOriginal<typeof import("./api")>(),
  watchWorkspace: watcher.watchWorkspace,
}));

import {
  libraryStructureSignature,
  shouldRefreshWorkspaceLibrary,
  useWorkspaceLibraryWatcher,
} from "./useWorkspaceLibraryWatcher";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  watcher.callback = undefined;
});

describe("workspace library watcher", () => {
  it("accepts Markdown and folder structure events but ignores unrelated changes", () => {
    expect(shouldRefreshWorkspaceLibrary({ type: { create: { kind: "file" } }, paths: ["/资料/子目录/新文档.md"] })).toBe(true);
    expect(shouldRefreshWorkspaceLibrary({ type: { remove: { kind: "folder" } }, paths: ["/资料/旧目录"] })).toBe(true);
    expect(shouldRefreshWorkspaceLibrary({ type: { modify: { kind: "rename", mode: "both" } }, paths: ["/资料/旧.md", "/资料/新.md"] })).toBe(true);
    expect(shouldRefreshWorkspaceLibrary({ type: { modify: { kind: "data", mode: "content" } }, paths: ["/资料/图片.png"] })).toBe(false);
    expect(shouldRefreshWorkspaceLibrary({ type: { access: { kind: "open", mode: "read" } }, paths: ["/资料/新文档.md"] })).toBe(false);
    expect(shouldRefreshWorkspaceLibrary({ type: { create: { kind: "file" } }, paths: ["/资料/.yulingmd/cache.md"] })).toBe(false);
  });

  it("uses relative paths to detect real library structure changes", () => {
    const documents = (paths: string[]): DocumentEntry[] => paths.map((relativePath) => ({
      path: `/资料/${relativePath}`, relativePath, title: relativePath, modifiedMs: 1,
    }));
    expect(libraryStructureSignature(documents(["A.md"]), ["目录"]))
      .toBe(libraryStructureSignature([{ ...documents(["A.md"])[0]!, modifiedMs: 99 }], ["目录"]));
    expect(libraryStructureSignature(documents(["A.md", "B.md"]), ["目录"]))
      .not.toBe(libraryStructureSignature(documents(["A.md"]), ["目录"]));
  });

  it("coalesces event bursts and releases the old watcher on workspace changes", async () => {
    const refresh = vi.fn(async () => undefined);
    function Harness({ workspace }: { workspace: string | null }) {
      useWorkspaceLibraryWatcher(workspace, refresh, vi.fn());
      return null;
    }
    const { rerender } = render(<Harness workspace="/资料" />);
    await waitFor(() => expect(watcher.watchWorkspace).toHaveBeenCalledWith("/资料", expect.any(Function)));
    const oldCallback = watcher.callback!;
    const event = { type: { create: { kind: "file" } }, paths: ["/资料/A.md"], attrs: {} };
    oldCallback(event);
    oldCallback(event);
    oldCallback(event);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    rerender(<Harness workspace="/另一个资料库" />);
    await waitFor(() => expect(watcher.unwatch).toHaveBeenCalledTimes(1));
    oldCallback(event);
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on window focus and reports watcher setup failures without crashing", async () => {
    const refresh = vi.fn(async () => undefined);
    const report = vi.fn();
    watcher.watchWorkspace.mockRejectedValueOnce(new Error("permission denied"));
    function Harness() {
      useWorkspaceLibraryWatcher("/资料", refresh, report);
      return null;
    }
    render(<Harness />);
    await waitFor(() => expect(report).toHaveBeenCalledWith(expect.stringContaining("permission denied")));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith("/资料"));
  });
});
