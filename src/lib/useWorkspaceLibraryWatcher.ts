import { useEffect, useRef } from "react";
import type { WatchEvent } from "@tauri-apps/plugin-fs";
import { watchWorkspace, type DocumentEntry } from "./api";

const refreshDelayMs = 100;

function isInternalPath(path: string): boolean {
  return path.replaceAll("\\", "/").split("/").includes(".yulingmd");
}

function isMarkdownPath(path: string): boolean {
  return path.endsWith(".md");
}

function looksLikeDirectoryPath(path: string): boolean {
  const name = path.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return name.length > 0 && !name.includes(".");
}

export function shouldRefreshWorkspaceLibrary(event: Pick<WatchEvent, "type" | "paths">): boolean {
  const paths = event.paths.filter((path) => !isInternalPath(path));
  if (paths.length === 0 || typeof event.type === "string") {
    return event.type === "any" && paths.some((path) => isMarkdownPath(path) || looksLikeDirectoryPath(path));
  }
  if ("create" in event.type) {
    return event.type.create.kind === "folder" || paths.some((path) => isMarkdownPath(path) || looksLikeDirectoryPath(path));
  }
  if ("remove" in event.type) {
    return event.type.remove.kind === "folder" || paths.some((path) => isMarkdownPath(path) || looksLikeDirectoryPath(path));
  }
  if ("modify" in event.type && event.type.modify.kind === "rename") {
    return true;
  }
  if ("modify" in event.type && event.type.modify.kind !== "data") {
    return paths.some(looksLikeDirectoryPath);
  }
  return false;
}

export function libraryStructureSignature(documents: DocumentEntry[], directories: string[]): string {
  const documentPaths = documents.map((document) => document.relativePath).sort();
  return `${documentPaths.join("\0")}\n${[...directories].sort().join("\0")}`;
}

export function useWorkspaceLibraryWatcher(
  workspace: string | null,
  refresh: (workspace: string) => Promise<unknown>,
  onError: (message: string) => void,
): void {
  const refreshRef = useRef(refresh);
  const errorRef = useRef(onError);
  refreshRef.current = refresh;
  errorRef.current = onError;

  useEffect(() => {
    if (!workspace) return;
    let disposed = false;
    let unwatch: (() => void) | undefined;
    let refreshTimer: number | null = null;
    let refreshing = false;
    let pending = false;

    const runRefresh = async () => {
      if (disposed) return;
      if (refreshing) {
        pending = true;
        return;
      }
      refreshing = true;
      do {
        pending = false;
        try {
          await refreshRef.current(workspace);
        } catch (reason) {
          errorRef.current(`文档库实时刷新失败：${String(reason)}`);
        }
      } while (!disposed && pending);
      refreshing = false;
    };

    const scheduleRefresh = () => {
      if (disposed) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void runRefresh();
      }, refreshDelayMs);
    };

    const handleFocus = () => scheduleRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    void watchWorkspace(workspace, (event) => {
      if (shouldRefreshWorkspaceLibrary(event)) scheduleRefresh();
    }).then((stop) => {
      if (disposed) stop();
      else unwatch = stop;
    }).catch((reason) => {
      if (!disposed) errorRef.current(`文档库实时监听不可用：${String(reason)}`);
    });

    return () => {
      disposed = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      unwatch?.();
    };
  }, [workspace]);
}
