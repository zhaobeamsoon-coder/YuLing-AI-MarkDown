import { describe, expect, it, vi } from "vitest";
import { importImageFiles } from "./editorImage";

function file(name: string, type: string) {
  return { name, type } as File;
}

describe("editor image import pipeline", () => {
  it("imports image files in source order and ignores unsupported files", async () => {
    const importer = vi.fn(async (input: File) => ({
      absolutePath: `/资料库/assets/2026/${input.name}`,
      markdownPath: `assets/2026/${input.name}`,
      reused: false,
    }));
    const result = await importImageFiles([
      file("一.png", "image/png"),
      file("说明.txt", "text/plain"),
      file("二.webp", "image/webp"),
    ], importer);

    expect(importer.mock.calls.map(([input]) => input.name)).toEqual(["一.png", "二.webp"]);
    expect(result.assets.map(({ file: input }) => input.name)).toEqual(["一.png", "二.webp"]);
    expect(result.rejected.map((input) => input.name)).toEqual(["说明.txt"]);
  });

  it("stops before returning a partial successful result when an import fails", async () => {
    const importer = vi.fn(async (input: File) => {
      if (input.name === "坏图.png") throw new Error("读取失败");
      return { absolutePath: input.name, markdownPath: input.name, reused: false };
    });
    await expect(importImageFiles([file("好图.png", "image/png"), file("坏图.png", "image/png")], importer))
      .rejects.toThrow("读取失败");
  });
});
