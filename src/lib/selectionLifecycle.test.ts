import { describe, expect, it } from "vitest";
import {
  idleSelectionLifecycle,
  reduceSelectionLifecycle,
  shouldPublishSelectionChange,
} from "./selectionLifecycle";

describe("WebKit selection event lifecycle", () => {
  it("publishes only after the primary pointer is released", () => {
    const dragging = reduceSelectionLifecycle(idleSelectionLifecycle, { type: "primary-down" });
    expect(shouldPublishSelectionChange(dragging, false, true)).toBe(false);
    const released = reduceSelectionLifecycle(dragging, { type: "pointer-up" });
    expect(shouldPublishSelectionChange(released, false, true)).toBe(true);
  });

  it("preserves a stable range across context menu, blur, and pointer cancellation", () => {
    let state = reduceSelectionLifecycle(idleSelectionLifecycle, { type: "primary-down" });
    state = reduceSelectionLifecycle(state, { type: "context-menu" });
    state = reduceSelectionLifecycle(state, { type: "blur" });
    state = reduceSelectionLifecycle(state, { type: "pointer-cancel" });
    expect(state).toEqual({ pointerSelecting: false, preserveOnRelease: true });
  });

  it("ignores selectionchange while updates are suppressed or the native range is unusable", () => {
    expect(shouldPublishSelectionChange(idleSelectionLifecycle, true, true)).toBe(false);
    expect(shouldPublishSelectionChange(idleSelectionLifecycle, false, false)).toBe(false);
  });
});
