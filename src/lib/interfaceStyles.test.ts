import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("quiet interaction styles", () => {
  it("keeps toolbar scrolling while hiding its visual scrollbar", () => {
    expect(styles).toMatch(/\.editor-toolbar\s*\{[^}]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.editor-toolbar\s*\{[^}]*scrollbar-width:\s*none/);
    expect(styles).toMatch(/\.editor-toolbar::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });

  it("renders the Emoji grid above the toolbar clipping boundary", () => {
    expect(styles).toMatch(/\.emoji-grid\s*\{[^}]*position:\s*fixed/);
  });

  it("uses a transparent eight-pixel table hit area with one centered line", () => {
    expect(styles).toMatch(/\.column-resize-handle\s*\{[^}]*width:\s*8px[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.column-resize-handle::after\s*\{[^}]*width:\s*2px/);
  });
});
