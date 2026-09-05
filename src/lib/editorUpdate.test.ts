import { describe, expect, it } from "vitest";
import { shouldEmitEditorUpdate } from "./editorUpdate";

describe("editor update boundary", () => {
  it("publishes only document-changing transactions", () => {
    expect(shouldEmitEditorUpdate({ docChanged: true })).toBe(true);
    expect(shouldEmitEditorUpdate({ docChanged: false })).toBe(false);
  });
});
