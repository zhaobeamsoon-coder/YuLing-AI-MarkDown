// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { loadWorkspaceSession, saveWorkspaceSession } from "./session";

afterEach(() => localStorage.clear());

describe("workspace session", () => {
  it("persists only workspace and relative Markdown tab paths", () => {
    saveWorkspaceSession({
      version: 1,
      workspace: "/资料库",
      tabs: ["项目/A.md", "B.md"],
      active: "B.md",
    });

    expect(loadWorkspaceSession()).toEqual({
      version: 1,
      workspace: "/资料库",
      tabs: ["项目/A.md", "B.md"],
      active: "B.md",
    });
    expect(localStorage.getItem("yuling-md-session-v1")).not.toContain("content");
  });

  it("rejects malformed or escaping saved paths", () => {
    localStorage.setItem("yuling-md-session-v1", JSON.stringify({
      version: 1,
      workspace: "/资料库",
      tabs: ["../密钥.md"],
      active: "../密钥.md",
    }));

    expect(loadWorkspaceSession()).toBeNull();
  });
});
