import { describe, expect, it } from "vitest";
import { clearRecentRecords, loadRecentRecords, recordRecentFile, recordRecentWorkspace, removeRecentWorkspace } from "./recent";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { length: 0, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: () => null,
    removeItem: (key) => { values.delete(key); }, setItem: (key, value) => { values.set(key, value); } };
}

describe("recent workspaces and files", () => {
  it("orders successful records and bounds each workspace to twenty files", () => {
    const storage = memoryStorage();
    let records = recordRecentWorkspace(loadRecentRecords(storage), "/资料库", 1, storage);
    for (let index = 0; index < 22; index += 1) records = recordRecentFile(records, "/资料库", `${index}.md`, index + 2, storage);
    expect(records.workspaces).toEqual([{ path: "/资料库", lastOpenedAt: 1 }]);
    expect(records.files).toHaveLength(20);
    expect(records.files[0].relativePath).toBe("21.md");
  });

  it("rejects malformed records without exposing stored paths", () => {
    const storage = memoryStorage();
    storage.setItem("yuling-md-recent-v1", JSON.stringify({ version: 1, workspaces: [{ path: "relative", lastOpenedAt: 1 }], files: [] }));
    expect(loadRecentRecords(storage)).toEqual({ version: 1, workspaces: [], files: [] });
  });

  it("removes a workspace with its files and can clear everything", () => {
    const storage = memoryStorage();
    let records = recordRecentWorkspace(loadRecentRecords(storage), "/资料库", 1, storage);
    records = recordRecentFile(records, "/资料库", "正文.md", 2, storage);
    expect(removeRecentWorkspace(records, "/资料库", storage).files).toEqual([]);
    expect(clearRecentRecords(storage)).toEqual({ version: 1, workspaces: [], files: [] });
  });
});
