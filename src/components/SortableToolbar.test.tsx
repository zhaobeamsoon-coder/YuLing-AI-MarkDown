// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortableToolbar } from "./SortableToolbar";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
});

function toolbar(onBold = vi.fn()) {
  return (
    <SortableToolbar>
      <button data-toolbar-id="bold" onClick={onBold}>粗体</button>
      <span className="toolbar-divider" />
      <button data-toolbar-id="quote">引用</button>
      <button data-toolbar-id="tasks" disabled>任务列表</button>
    </SortableToolbar>
  );
}

function orderedIds() {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-toolbar-item]"), (item) => item.dataset.toolbarItem);
}

describe("sortable toolbar", () => {
  it("moves any control to the front and restores the default order", () => {
    render(toolbar());
    fireEvent.contextMenu(document.querySelector('[data-toolbar-item="tasks"]')!);
    fireEvent.click(screen.getByRole("button", { name: "移到最前面" }));
    expect(orderedIds()).toEqual(["tasks", "bold", "quote"]);
    expect(JSON.parse(localStorage.getItem("yuling-toolbar-order-v1")!)).toEqual(["tasks", "bold", "quote"]);

    fireEvent.contextMenu(document.querySelector('[data-toolbar-item="tasks"]')!);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认顺序" }));
    expect(orderedIds()).toEqual(["bold", "quote", "tasks"]);
  });

  it("restores a valid saved order and repairs stale or duplicate ids", () => {
    localStorage.setItem("yuling-toolbar-order-v1", JSON.stringify(["tasks", "removed", "tasks", "bold"]));
    render(toolbar());
    expect(orderedIds()).toEqual(["tasks", "bold", "quote"]);
  });

  it("falls back to the default order when persisted data is malformed", () => {
    localStorage.setItem("yuling-toolbar-order-v1", "{broken");
    render(toolbar());
    expect(orderedIds()).toEqual(["bold", "quote", "tasks"]);
  });

  it("drags from the handle without invoking the formatting command", () => {
    const onBold = vi.fn();
    render(toolbar(onBold));
    const handle = document.querySelector<HTMLElement>('[data-toolbar-item="bold"] .toolbar-drag-handle')!;
    const quote = document.querySelector<HTMLElement>('[data-toolbar-item="quote"]')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: vi.fn(() => quote) });
    vi.spyOn(quote, "getBoundingClientRect").mockReturnValue({
      left: 100, right: 160, top: 0, bottom: 30, width: 60, height: 30, x: 100, y: 0, toJSON: () => ({}),
    });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 150, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 150, clientY: 10 });

    expect(orderedIds()).toEqual(["quote", "bold", "tasks"]);
    expect(onBold).not.toHaveBeenCalled();
  });
});
