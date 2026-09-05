export type SpecialSelectionMode = "visible" | "markdown";

export const specialSelectionModeKey = "yuling-special-selection-mode-v1";
export const defaultSpecialSelectionMode: SpecialSelectionMode = "visible";
type SelectionPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function loadSpecialSelectionMode(storage: SelectionPreferenceStorage = localStorage): SpecialSelectionMode {
  try {
    return storage.getItem(specialSelectionModeKey) === "markdown" ? "markdown" : defaultSpecialSelectionMode;
  } catch {
    return defaultSpecialSelectionMode;
  }
}

export function saveSpecialSelectionMode(mode: SpecialSelectionMode, storage: SelectionPreferenceStorage = localStorage): void {
  storage.setItem(specialSelectionModeKey, mode);
}
