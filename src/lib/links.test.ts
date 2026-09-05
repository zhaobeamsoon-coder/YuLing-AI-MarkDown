import { describe, expect, it } from "vitest";
import { isExternalLink, normalizeLinkTarget } from "./links";

describe("Markdown link targets", () => {
  it("accepts web, mail, anchor and relative Markdown links", () => {
    expect(normalizeLinkTarget(" https://openai.com/docs ")).toBe("https://openai.com/docs");
    expect(normalizeLinkTarget("mailto:writer@example.com")).toBe("mailto:writer@example.com");
    expect(normalizeLinkTarget("#当前标题")).toBe("#当前标题");
    expect(normalizeLinkTarget("../资料/说明.md")).toBe("../资料/说明.md");
  });

  it("rejects executable, local-file and protocol-relative targets", () => {
    for (const target of ["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "//tracker.example/x", "line\nbreak"]) {
      expect(() => normalizeLinkTarget(target)).toThrow(/链接地址|链接协议/);
    }
  });

  it("only marks http, https and mailto as external links", () => {
    expect(isExternalLink("https://openai.com")).toBe(true);
    expect(isExternalLink("mailto:writer@example.com")).toBe(true);
    expect(isExternalLink("../资料.md")).toBe(false);
    expect(isExternalLink("#标题")).toBe(false);
  });
});
