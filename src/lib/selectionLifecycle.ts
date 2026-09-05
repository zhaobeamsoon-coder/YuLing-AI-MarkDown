export interface SelectionLifecycleState {
  pointerSelecting: boolean;
  preserveOnRelease: boolean;
}

export type SelectionLifecycleEvent =
  | { type: "primary-down" }
  | { type: "pointer-up" }
  | { type: "pointer-cancel" }
  | { type: "context-menu" }
  | { type: "blur" };

export const idleSelectionLifecycle: SelectionLifecycleState = {
  pointerSelecting: false,
  preserveOnRelease: false,
};

export function reduceSelectionLifecycle(
  state: SelectionLifecycleState,
  event: SelectionLifecycleEvent,
): SelectionLifecycleState {
  if (event.type === "primary-down") return { pointerSelecting: true, preserveOnRelease: false };
  if (event.type === "pointer-cancel") return { pointerSelecting: false, preserveOnRelease: true };
  if (event.type === "pointer-up") return { pointerSelecting: false, preserveOnRelease: false };
  if (event.type === "context-menu" || event.type === "blur") {
    return { ...state, preserveOnRelease: true };
  }
  return state;
}

export function shouldPublishSelectionChange(
  state: SelectionLifecycleState,
  suppressed: boolean,
  nativeSelectionIsUsable: boolean,
): boolean {
  return !state.pointerSelecting && !suppressed && nativeSelectionIsUsable;
}
