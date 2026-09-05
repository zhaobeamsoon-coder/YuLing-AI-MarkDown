// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { loadCrashDrafts, removeCrashDraft, saveCrashDraft } from "./crashDraft";

afterEach(() => localStorage.clear());

describe("crash drafts", () => {
  it("stores unsaved content by document path and removes only that draft", () => {
    saveCrashDraft({ workspace: "/资料库", path: "/资料库/A.md", relativePath: "A.md", content: "未保存 A", baseModifiedMs: 1, updatedAt: 10 });
    saveCrashDraft({ workspace: "/资料库", path: "/资料库/B.md", relativePath: "B.md", content: "未保存 B", baseModifiedMs: 2, updatedAt: 20 });

    removeCrashDraft("/资料库/A.md");

    expect(loadCrashDrafts()).toEqual([{
      workspace: "/资料库", path: "/资料库/B.md", relativePath: "B.md", content: "未保存 B", baseModifiedMs: 2, updatedAt: 20,
    }]);
  });

  it("rejects malformed records instead of exposing arbitrary local data", () => {
    localStorage.setItem("yuling-md-crash-drafts-v1", JSON.stringify([{ workspace: "/资料库", path: 3, content: {} }]));
    expect(loadCrashDrafts()).toEqual([]);
  });
});
