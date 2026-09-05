import { describe, expect, it } from "vitest";
import {
  defaultSpecialSelectionMode,
  loadSpecialSelectionMode,
  saveSpecialSelectionMode,
  specialSelectionModeKey,
} from "./selectionPreferences";

describe("special selection preferences", () => {
  it("defaults invalid and missing values to visible text", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };

    expect(loadSpecialSelectionMode(adapter)).toBe(defaultSpecialSelectionMode);
    storage.set(specialSelectionModeKey, "broken");
    expect(loadSpecialSelectionMode(adapter)).toBe("visible");
  });

  it("persists the Markdown source mode", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
    };

    saveSpecialSelectionMode("markdown", adapter);
    expect(loadSpecialSelectionMode(adapter)).toBe("markdown");
  });
});
