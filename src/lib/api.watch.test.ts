import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  watch: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn(),
  invoke: vi.fn(),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn(),
  writeHtml: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ watch: tauri.watch }));

import { watchWorkspace } from "./api";

describe("watchWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.watch.mockResolvedValue(tauri.stop);
  });

  it("starts the native watcher recursively with the RC debounce", async () => {
    const callback = vi.fn();

    await expect(watchWorkspace("/资料库", callback)).resolves.toBe(tauri.stop);
    expect(tauri.watch).toHaveBeenCalledWith("/资料库", callback, {
      recursive: true,
      delayMs: 250,
    });
  });
});
