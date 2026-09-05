// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { centerEditorSelection } from "./typewriter";

describe("typewriter mode", () => {
  it("centers the current selection in the editor viewport", () => {
    const scrollBy = vi.fn();
    const scroll = document.createElement("div");
    scroll.className = "editor-scroll";
    Object.assign(scroll, { scrollBy });
    scroll.getBoundingClientRect = () => ({ top: 100, height: 600 }) as DOMRect;
    const editor = document.createElement("div");
    scroll.append(editor);
    const view = {
      dom: editor,
      state: { selection: { head: 9 } },
      coordsAtPos: vi.fn(() => ({ top: 520, bottom: 540, left: 0, right: 0 })),
    };

    expect(centerEditorSelection(view as never)).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ top: 120, behavior: "smooth" });
  });
});
