// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  chooseHtmlPath: vi.fn(async () => "/tmp/文档.html"),
  writeExportHtml: vi.fn(async (_path: string, _html: string) => undefined),
}));
const markdownLib = vi.hoisted(() => ({
  markdownToSafeHtml: vi.fn(async () => "<h1>正文</h1>"),
}));

vi.mock("pagedjs", () => ({
  Previewer: class {
    async preview(_html: string, _styles: unknown[], target: HTMLElement) {
      const page = document.createElement("div");
      page.className = "pagedjs_page";
      target.append(page);
      return { total: 1 };
    }
  },
}));

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));
vi.mock("../lib/markdown", () => ({
  markdownToSafeHtml: markdownLib.markdownToSafeHtml,
  renderMermaidInHtml: vi.fn(async (html: string) => html),
  plainTextFromMarkdown: vi.fn(() => "正文"),
}));
vi.mock("../lib/api", () => ({
  ...api,
  capturePdfPage: vi.fn(),
  chooseImagePath: vi.fn(),
  choosePdfPath: vi.fn(),
  copyRichHtml: vi.fn(),
  localAssetUrl: (path: string) => path,
  mergePdfPages: vi.fn(),
  saveCredential: vi.fn(),
  uploadAssets: vi.fn(),
  writeExportImage: vi.fn(),
}));

import { ExportPanel } from "./ExportPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("ExportPanel", () => {
  it("exposes persistent page settings and the system print path", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    render(<ExportPanel markdown="# 正文" title="测试文档" workspace="/资料库" onClose={vi.fn()} />);
    expect(await screen.findByText("1 页")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "页面设置" }));
    fireEvent.change(screen.getByLabelText("上边距（mm）"), { target: { value: "12" } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem("yuling-print-settings") ?? "{}").marginTop).toBe(12));

    fireEvent.click(screen.getByRole("button", { name: "系统打印" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("writes a standalone HTML file through an authorized save path", async () => {
    render(<ExportPanel markdown="# 正文" title="测试文档" workspace="/资料库" onClose={vi.fn()} />);
    await screen.findByText("1 页");
    fireEvent.click(screen.getByRole("button", { name: "导出 HTML" }));

    await waitFor(() => expect(api.writeExportHtml).toHaveBeenCalled());
    expect(api.chooseHtmlPath).toHaveBeenCalledWith("测试文档.html");
    expect(api.writeExportHtml.mock.calls[0][0]).toBe("/tmp/文档.html");
    expect(api.writeExportHtml.mock.calls[0][1]).toContain("<!doctype html>");
    expect(markdownLib.markdownToSafeHtml).toHaveBeenCalledTimes(2);
  });
});
