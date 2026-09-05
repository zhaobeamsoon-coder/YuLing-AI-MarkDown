import { useEffect, useRef } from "react";
import { removeCrashDraft, saveCrashDraft } from "./crashDraft";

export interface DraftableTab {
  path: string;
  relativePath: string;
  content: string;
  savedContent: string;
  modifiedMs: number;
}

export function persistCrashDraftTabs(tabs: DraftableTab[], workspace: string | null, protectedPaths: string[]): void {
  const protectedSet = new Set(protectedPaths);
  tabs.forEach((tab) => {
    if (tab.content !== tab.savedContent) {
      saveCrashDraft({
        workspace: workspace ?? tab.path.slice(0, -tab.relativePath.length - 1),
        path: tab.path,
        relativePath: tab.relativePath,
        content: tab.content,
        baseModifiedMs: tab.modifiedMs,
        updatedAt: Date.now(),
      });
    } else if (!protectedSet.has(tab.path)) {
      removeCrashDraft(tab.path);
    }
  });
}

export function useCrashDraftPersistence(
  enabled: boolean,
  tabs: DraftableTab[],
  workspace: string | null,
  protectedPaths: string[],
): void {
  const latest = useRef({ tabs, workspace, protectedPaths });
  latest.current = { tabs, workspace, protectedPaths };
  const protectedKey = protectedPaths.join("\0");

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => persistCrashDraftTabs(tabs, workspace, protectedPaths), 300);
    return () => window.clearTimeout(timer);
  }, [enabled, protectedKey, tabs, workspace]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => persistCrashDraftTabs(latest.current.tabs, latest.current.workspace, latest.current.protectedPaths);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [enabled]);
}
