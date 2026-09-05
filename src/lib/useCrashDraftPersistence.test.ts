// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCrashDrafts, saveCrashDraft } from "./crashDraft";
import { useCrashDraftPersistence } from "./useCrashDraftPersistence";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("crash draft persistence", () => {
  it("debounces repeated editor updates and preserves pending recovery drafts", () => {
    vi.useFakeTimers();
    saveCrashDraft({ workspace: "/资料", path: "/资料/B.md", relativePath: "B.md", content: "旧草稿", baseModifiedMs: 1, updatedAt: 1 });
    const clean = { path: "/资料/B.md", relativePath: "B.md", content: "磁盘", savedContent: "磁盘", modifiedMs: 1 };
    const dirty = { path: "/资料/A.md", relativePath: "A.md", content: "1", savedContent: "", modifiedMs: 1 };
    const { rerender } = renderHook(({ content }) => useCrashDraftPersistence(true, [{ ...dirty, content } , clean], "/资料", [clean.path]), {
      initialProps: { content: "1" },
    });

    rerender({ content: "12" });
    rerender({ content: "123" });
    expect(loadCrashDrafts().find((draft) => draft.path === dirty.path)).toBeUndefined();
    act(() => vi.advanceTimersByTime(300));

    expect(loadCrashDrafts().find((draft) => draft.path === dirty.path)?.content).toBe("123");
    expect(loadCrashDrafts().some((draft) => draft.path === clean.path)).toBe(true);
  });
});
