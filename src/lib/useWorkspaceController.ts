import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  authorizeWorkspace,
  chooseMarkdownFile,
  chooseWorkspace,
  listDirectories,
  listDocuments,
  loadLayout,
  onOpenedMarkdown,
  readDocument,
  reindexWorkspace,
  takeOpenedMarkdown,
  type DocumentEntry,
  type OpenedMarkdown,
} from "./api";
import { loadCrashDrafts, type CrashDraft } from "./crashDraft";
import { clearWorkspaceSession, loadWorkspaceSession, saveWorkspaceSession } from "./session";
import { libraryStructureSignature, useWorkspaceLibraryWatcher } from "./useWorkspaceLibraryWatcher";
import { normalizeWorkspaceLayout, type TiptapNode, type WorkspaceLayout } from "./tableLayout";

export interface OpenDocument extends DocumentEntry {
  content: string;
  savedContent: string;
  documentJson: TiptapNode | null;
  saving: boolean;
}

interface WorkspaceControllerOptions {
  tabs: OpenDocument[];
  setTabs: Dispatch<SetStateAction<OpenDocument[]>>;
  setClosedDocuments: Dispatch<SetStateAction<DocumentEntry[]>>;
  activePath: string | null;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setSelection: Dispatch<SetStateAction<string>>;
  setLibraryVisible: Dispatch<SetStateAction<boolean>>;
  setAiVisible: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setWorkspaceError: Dispatch<SetStateAction<string | null>>;
  setScanningWorkspace: Dispatch<SetStateAction<boolean>>;
  setRecoveryDrafts: Dispatch<SetStateAction<CrashDraft[]>>;
  layout: MutableRefObject<WorkspaceLayout>;
  rememberWorkspace: (path: string) => void;
  rememberFile: (workspace: string, relativePath: string) => void;
}

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") || "未命名";
}

export function useWorkspaceController(options: WorkspaceControllerOptions) {
  const {
    tabs, setTabs, setClosedDocuments, activePath, setActivePath, setSelection,
    setLibraryVisible, setAiVisible, setStatus, setWorkspaceError,
    setScanningWorkspace, setRecoveryDrafts, layout, rememberWorkspace, rememberFile,
  } = options;
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [sessionReady, setSessionReady] = useState(false);
  const indexTimer = useRef<number | null>(null);
  const librarySignature = useRef("");

  const refreshDocuments = useCallback(async (
    root: string,
    refreshOptions: { quiet?: boolean; indexOnlyWhenChanged?: boolean } = {},
  ) => {
    const [entries, folders] = await Promise.all([listDocuments(root), listDirectories(root)]);
    const nextSignature = libraryStructureSignature(entries, folders);
    const structureChanged = nextSignature !== librarySignature.current;
    librarySignature.current = nextSignature;
    setDocuments(entries);
    setDirectories(folders);
    if (!refreshOptions.quiet) setStatus(`已载入 ${entries.length} 篇文档`);
    if (refreshOptions.indexOnlyWhenChanged && !structureChanged) return entries;
    if (indexTimer.current !== null) window.clearTimeout(indexTimer.current);
    indexTimer.current = window.setTimeout(() => {
      indexTimer.current = null;
      void reindexWorkspace(root)
        .then((count) => {
          if (!refreshOptions.quiet) setStatus(`已索引 ${count} 篇文档`);
        })
        .catch((reason) => setStatus(`文档可正常使用，索引稍后重试：${String(reason)}`));
    }, 600);
    return entries;
  }, [setStatus]);

  useWorkspaceLibraryWatcher(
    workspace,
    (root) => refreshDocuments(root, { quiet: true, indexOnlyWhenChanged: true }),
    setStatus,
  );

  const openDocument = useCallback(async (entry: DocumentEntry) => {
    const existing = tabs.find((tab) => tab.path === entry.path);
    if (existing) {
      setActivePath(entry.path);
      if (workspace) rememberFile(workspace, entry.relativePath);
      return;
    }
    setStatus("正在打开…");
    const loaded = await readDocument(entry.path);
    setTabs((current) => [...current, { ...entry, ...loaded, savedContent: loaded.content, documentJson: null, saving: false }]);
    setActivePath(entry.path);
    if (workspace) rememberFile(workspace, entry.relativePath);
    setStatus("已打开");
  }, [rememberFile, setActivePath, setStatus, setTabs, tabs, workspace]);

  const activateWorkspace = useCallback(async (chosen: string) => {
    const authorized = await authorizeWorkspace(chosen);
    setWorkspace(authorized);
    setTabs([]);
    setClosedDocuments([]);
    setActivePath(null);
    setSelection("");
    setDocuments([]);
    setDirectories([]);
    setLibraryVisible(true);
    setAiVisible(false);
    try {
      layout.current = normalizeWorkspaceLayout(JSON.parse(await loadLayout(authorized)));
    } catch {
      layout.current = { version: 2, documents: {}, images: {} };
    }
    await refreshDocuments(authorized);
    rememberWorkspace(authorized);
    return authorized;
  }, [layout, refreshDocuments, rememberWorkspace, setActivePath, setAiVisible, setClosedDocuments, setLibraryVisible, setSelection, setTabs]);

  const openWorkspace = async () => {
    try {
      setWorkspaceError(null);
      setScanningWorkspace(true);
      setStatus("正在选择文档库…");
      const chosen = await chooseWorkspace();
      if (!chosen) {
        setStatus("已取消");
        return;
      }
      setStatus("正在扫描 Markdown 文档…");
      await activateWorkspace(chosen);
    } catch (reason) {
      const message = String(reason);
      setWorkspaceError(message);
      setStatus(`无法打开文档库：${message}`);
    } finally {
      setScanningWorkspace(false);
    }
  };

  const loadOpenedMarkdown = useCallback(async (opened: OpenedMarkdown) => {
    setWorkspaceError(null);
    setScanningWorkspace(true);
    setStatus("正在打开 Markdown 文档…");
    try {
      let nextLayout: WorkspaceLayout;
      try {
        nextLayout = normalizeWorkspaceLayout(JSON.parse(await loadLayout(opened.workspace)));
      } catch {
        nextLayout = { version: 2, documents: {}, images: {} };
      }
      const [entries, folders] = await Promise.all([listDocuments(opened.workspace), listDirectories(opened.workspace)]);
      const relativePath = opened.path.startsWith(`${opened.workspace}/`)
        ? opened.path.slice(opened.workspace.length + 1)
        : opened.path.split("/").at(-1) ?? "文档.md";
      const entry = entries.find((document) => document.path === opened.path) ?? {
        path: opened.path, relativePath, title: titleFromPath(opened.path), modifiedMs: 0,
      };
      const loaded = await readDocument(opened.path);
      layout.current = nextLayout;
      setWorkspace(opened.workspace);
      setClosedDocuments([]);
      setSelection("");
      setDocuments(entries);
      setDirectories(folders);
      setLibraryVisible(true);
      setAiVisible(false);
      setTabs([{ ...entry, ...loaded, savedContent: loaded.content, documentJson: null, saving: false }]);
      setActivePath(opened.path);
      setRecoveryDrafts(loadCrashDrafts()
        .filter((draft) => draft.path === opened.path && draft.content !== loaded.content)
        .sort((left, right) => right.updatedAt - left.updatedAt));
      setStatus("已打开");
      rememberWorkspace(opened.workspace);
      rememberFile(opened.workspace, relativePath);
      if (indexTimer.current !== null) window.clearTimeout(indexTimer.current);
      indexTimer.current = window.setTimeout(() => {
        indexTimer.current = null;
        void reindexWorkspace(opened.workspace)
          .then((count) => setStatus(`已索引 ${count} 篇文档`))
          .catch((reason) => setStatus(`文档可正常使用，索引稍后重试：${String(reason)}`));
      }, 600);
    } catch (reason) {
      setWorkspaceError(String(reason));
      setStatus(`无法打开 Markdown 文档：${String(reason)}`);
    } finally {
      setScanningWorkspace(false);
    }
  }, [layout, rememberFile, rememberWorkspace, setActivePath, setAiVisible, setClosedDocuments, setLibraryVisible, setRecoveryDrafts, setScanningWorkspace, setSelection, setStatus, setTabs, setWorkspaceError]);

  const openSingleMarkdown = async () => {
    try {
      const opened = await chooseMarkdownFile();
      if (opened) await loadOpenedMarkdown(opened);
    } catch (reason) {
      setStatus(`无法打开 Markdown 文档：${String(reason)}`);
    }
  };

  const restoreLastSession = useCallback(async () => {
    const session = loadWorkspaceSession();
    if (!session) return;
    try {
      const authorized = await authorizeWorkspace(session.workspace);
      setWorkspace(authorized);
      setLibraryVisible(true);
      setAiVisible(false);
      try {
        layout.current = normalizeWorkspaceLayout(JSON.parse(await loadLayout(authorized)));
      } catch {
        layout.current = { version: 2, documents: {}, images: {} };
      }
      const entries = await refreshDocuments(authorized);
      const requested = session.tabs
        .map((relativePath) => entries.find((entry) => entry.relativePath === relativePath))
        .filter((entry): entry is DocumentEntry => Boolean(entry));
      const restored = (await Promise.all(requested.map(async (entry): Promise<OpenDocument | null> => {
        try {
          const loaded = await readDocument(entry.path);
          return { ...entry, ...loaded, savedContent: loaded.content, documentJson: null, saving: false };
        } catch {
          return null;
        }
      }))).filter((entry): entry is OpenDocument => entry !== null);
      setTabs(restored);
      const drafts = loadCrashDrafts();
      setRecoveryDrafts(drafts
        .filter((draft) => restored.some((entry) => entry.path === draft.path && entry.content !== draft.content))
        .sort((left, right) => right.updatedAt - left.updatedAt));
      const requestedActive = entries.find((entry) => entry.relativePath === session.active)?.path;
      setActivePath(restored.some((entry) => entry.path === requestedActive) ? requestedActive ?? null : restored[0]?.path ?? null);
      setStatus(restored.length ? "已恢复上次会话" : "已恢复上次文档库");
    } catch {
      clearWorkspaceSession();
      setStatus("上次文档库不可用，已跳过恢复");
    }
  }, [layout, refreshDocuments, setActivePath, setAiVisible, setLibraryVisible, setRecoveryDrafts, setStatus, setTabs]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const drain = async () => {
      const pending = await takeOpenedMarkdown();
      const opened = pending.at(-1);
      if (!disposed && opened) await loadOpenedMarkdown(opened);
      return Boolean(opened);
    };
    void onOpenedMarkdown(() => void drain()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    void (async () => {
      const opened = await drain();
      if (!opened && !disposed) await restoreLastSession();
      if (!disposed) setSessionReady(true);
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [loadOpenedMarkdown, restoreLastSession]);

  const sessionTabPaths = tabs.map((tab) => tab.relativePath).join("\0");
  useEffect(() => {
    if (!sessionReady) return;
    if (!workspace) {
      clearWorkspaceSession();
      return;
    }
    saveWorkspaceSession({
      version: 1,
      workspace,
      tabs: tabs.map((tab) => tab.relativePath),
      active: tabs.find((tab) => tab.path === activePath)?.relativePath ?? null,
    });
  }, [activePath, sessionReady, sessionTabPaths, tabs, workspace]);

  useEffect(() => () => {
    if (indexTimer.current !== null) window.clearTimeout(indexTimer.current);
  }, []);

  return {
    workspace, documents, directories, sessionReady, refreshDocuments,
    openDocument, activateWorkspace, openWorkspace, loadOpenedMarkdown, openSingleMarkdown,
  };
}
