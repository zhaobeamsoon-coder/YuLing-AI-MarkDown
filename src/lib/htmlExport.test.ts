// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { embedLocalImages, standaloneHtmlDocument } from "./htmlExport";

describe("HTML export", () => {
  it("creates a standalone UTF-8 document and escapes the title", () => {
    const output = standaloneHtmlDocument('标题 <"一">', "<h1>正文</h1>", "body{color:#222}");
    expect(output).toContain('<meta charset="utf-8">');
    expect(output).toContain("标题 &lt;&quot;一&quot;&gt;");
    expect(output).toContain("<h1>正文</h1>");
    expect(output).toContain("body{color:#222}");
  });

  it("embeds local images but leaves network images unchanged", async () => {
    const resolver = vi.fn(async () => "data:image/png;base64,AAAA");
    const output = await embedLocalImages('<img src="assets/a.png"><img src="https://example.com/b.png">', resolver);
    expect(resolver).toHaveBeenCalledWith("assets/a.png");
    expect(output).toContain("data:image/png;base64,AAAA");
    expect(output).toContain("https://example.com/b.png");
  });
});
