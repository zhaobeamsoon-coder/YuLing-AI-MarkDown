import { describe, expect, it } from "vitest";
import { buildPrintCss, defaultPrintSettings } from "./printSettings";

describe("print settings", () => {
  it("applies paper, margins, font, header and footer safely", () => {
    const css = buildPrintCss({
      ...defaultPrintSettings,
      paper: "Letter",
      marginTop: 12,
      marginRight: 14,
      marginBottom: 16,
      marginLeft: 10,
      font: "serif",
      header: '{title} "页眉"',
      footer: "内部文档",
    }, "测试稿");
    expect(css).toContain("size: Letter");
    expect(css).toContain("margin: 12mm 14mm 16mm 10mm");
    expect(css).toContain("Songti SC");
    expect(css).toContain('测试稿 \\"页眉\\"');
    expect(css).toContain('"内部文档  ·  " counter(page)');
  });

  it("clamps unsafe page margins", () => {
    const css = buildPrintCss({ ...defaultPrintSettings, marginTop: -10, marginRight: 100 }, "标题");
    expect(css).toContain("margin: 5mm 50mm 20mm 18mm");
  });
});
