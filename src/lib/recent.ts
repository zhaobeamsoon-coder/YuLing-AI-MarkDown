export interface RecentWorkspace {
  path: string;
  lastOpenedAt: number;
}

export interface RecentFile {
  workspace: string;
  relativePath: string;
  lastOpenedAt: number;
}

export interface RecentRecords {
  version: 1;
  workspaces: RecentWorkspace[];
  files: RecentFile[];
}

const recentKey = "yuling-md-recent-v1";
const emptyRecords = (): RecentRecords => ({ version: 1, workspaces: [], files: [] });

function safeWorkspace(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.includes("\0");
}

function safeRelativeMarkdown(path: unknown): path is string {
  return typeof path === "string" && path.endsWith(".md") && !path.startsWith("/")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function loadRecentRecords(storage: Storage = localStorage): RecentRecords {
  try {
    const parsed = JSON.parse(storage.getItem(recentKey) ?? "null") as Partial<RecentRecords> | null;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.workspaces) || !Array.isArray(parsed.files)) return emptyRecords();
    if (!parsed.workspaces.every((item) => safeWorkspace(item?.path) && Number.isFinite(item?.lastOpenedAt))) return emptyRecords();
    if (!parsed.files.every((item) => safeWorkspace(item?.workspace) && safeRelativeMarkdown(item?.relativePath) && Number.isFinite(item?.lastOpenedAt))) return emptyRecords();
    return { version: 1, workspaces: parsed.workspaces.slice(0, 10), files: parsed.files.slice(0, 200) };
  } catch {
    return emptyRecords();
  }
}

function persist(records: RecentRecords, storage: Storage): RecentRecords {
  storage.setItem(recentKey, JSON.stringify(records));
  return records;
}

export function recordRecentWorkspace(records: RecentRecords, path: string, now = Date.now(), storage: Storage = localStorage): RecentRecords {
  const workspaces = [{ path, lastOpenedAt: now }, ...records.workspaces.filter((item) => item.path !== path)].slice(0, 10);
  return persist({ ...records, workspaces }, storage);
}

export function recordRecentFile(records: RecentRecords, workspace: string, relativePath: string, now = Date.now(), storage: Storage = localStorage): RecentRecords {
  const sameWorkspace = records.files.filter((item) => item.workspace === workspace && item.relativePath !== relativePath);
  const otherWorkspaces = records.files.filter((item) => item.workspace !== workspace);
  const files = [{ workspace, relativePath, lastOpenedAt: now }, ...sameWorkspace].slice(0, 20).concat(otherWorkspaces).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  return persist({ ...records, files }, storage);
}

export function removeRecentWorkspace(records: RecentRecords, path: string, storage: Storage = localStorage): RecentRecords {
  return persist({ ...records, workspaces: records.workspaces.filter((item) => item.path !== path), files: records.files.filter((item) => item.workspace !== path) }, storage);
}

export function removeRecentFile(records: RecentRecords, workspace: string, relativePath: string, storage: Storage = localStorage): RecentRecords {
  return persist({ ...records, files: records.files.filter((item) => item.workspace !== workspace || item.relativePath !== relativePath) }, storage);
}

export function clearRecentRecords(storage: Storage = localStorage): RecentRecords {
  storage.removeItem(recentKey);
  return emptyRecords();
}
