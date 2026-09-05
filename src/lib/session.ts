export interface WorkspaceSession {
  version: 1;
  workspace: string;
  tabs: string[];
  active: string | null;
}

const sessionKey = "yuling-md-session-v1";

function safeRelativeMarkdown(path: unknown): path is string {
  return typeof path === "string"
    && path.endsWith(".md")
    && !path.startsWith("/")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export function loadWorkspaceSession(storage: Storage = localStorage): WorkspaceSession | null {
  try {
    const parsed = JSON.parse(storage.getItem(sessionKey) ?? "null") as Partial<WorkspaceSession> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.workspace !== "string" || !parsed.workspace.startsWith("/")) return null;
    if (!Array.isArray(parsed.tabs) || !parsed.tabs.every(safeRelativeMarkdown)) return null;
    if (parsed.active !== null && parsed.active !== undefined && !safeRelativeMarkdown(parsed.active)) return null;
    return {
      version: 1,
      workspace: parsed.workspace,
      tabs: [...new Set(parsed.tabs)],
      active: parsed.active ?? null,
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSession(session: WorkspaceSession, storage: Storage = localStorage): void {
  storage.setItem(sessionKey, JSON.stringify(session));
}

export function clearWorkspaceSession(storage: Storage = localStorage): void {
  storage.removeItem(sessionKey);
}
