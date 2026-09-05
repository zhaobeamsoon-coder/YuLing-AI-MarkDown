export interface CrashDraft {
  workspace: string;
  path: string;
  relativePath: string;
  content: string;
  baseModifiedMs: number;
  updatedAt: number;
}

const draftKey = "yuling-md-crash-drafts-v1";

function isCrashDraft(value: unknown): value is CrashDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<CrashDraft>;
  return typeof draft.workspace === "string"
    && draft.workspace.startsWith("/")
    && typeof draft.path === "string"
    && draft.path.startsWith(`${draft.workspace}/`)
    && typeof draft.relativePath === "string"
    && draft.relativePath.endsWith(".md")
    && !draft.relativePath.split("/").some((part) => part === "." || part === "..")
    && typeof draft.content === "string"
    && typeof draft.baseModifiedMs === "number"
    && typeof draft.updatedAt === "number";
}

export function loadCrashDrafts(storage: Storage = localStorage): CrashDraft[] {
  try {
    const parsed = JSON.parse(storage.getItem(draftKey) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isCrashDraft) : [];
  } catch {
    return [];
  }
}

export function saveCrashDraft(draft: CrashDraft, storage: Storage = localStorage): void {
  const drafts = loadCrashDrafts(storage).filter((current) => current.path !== draft.path);
  storage.setItem(draftKey, JSON.stringify([draft, ...drafts].slice(0, 20)));
}

export function removeCrashDraft(path: string, storage: Storage = localStorage): void {
  const drafts = loadCrashDrafts(storage).filter((draft) => draft.path !== path);
  if (drafts.length) storage.setItem(draftKey, JSON.stringify(drafts));
  else storage.removeItem(draftKey);
}
