import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import "./styles.css";
import { AiPanel } from "./components/AiPanel";
import { EditorPane } from "./components/EditorPane";
import { ExportPanel } from "./components/ExportPanel";
import { FileSidebar } from "./components/FileSidebar";
import { WorkspaceNavigator } from "./components/WorkspaceNavigator";
import {
  chooseMarkdownSavePath,
  createDocument,
  duplicateDocument,
  moveDocument,
  readDocument,
  reindexWorkspace,
  revealDocumentInFinder,
  trashDocument,
  writeDocument,
  writeMarkdownCopy,
  copyPlainText,
  type DocumentEntry,
} from "./lib/api";
import { extractImageLayouts, extractTableLayouts, type ImageLayout, type TableLayout, type TiptapNode, type WorkspaceLayout } from "./lib/tableLayout";
import { saveLayout } from "./lib/api";
import { nextDuplicateDocumentPath, nextUntitledDocumentPath, parentFolder } from "./lib/fileTree";
import { type WritingStatistics } from "./lib/statistics";
import { removeCrashDraft, type CrashDraft } from "./lib/crashDraft";
import { useCrashDraftPersistence } from "./lib/useCrashDraftPersistence";
import { AppTopbar, StatusBar, WelcomeScreen } from "./components/AppChrome";
import { useFolderOperations } from "./lib/useFolderOperations";
import { useRecentRecords } from "./lib/useRecentRecords";
import { useRecentActions } from "./lib/useRecentActions";
import { useWorkspaceController, type OpenDocument } from "./lib/useWorkspaceController";
import { useAiTaskController } from "./lib/useAiTaskController";
import { useAppShortcuts } from "./lib/useAppShortcuts";
import {
  loadSpecialSelectionMode,
  saveSpecialSelectionMode,
  type SpecialSelectionMode,
} from "./lib/selectionPreferences";

export type { OpenDocument } from "./lib/useWorkspaceController";

function titleFromPath(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/i, "") || "未命名";
}

const emptyTableLayouts: TableLayout[] = [];
const emptyImageLayouts: ImageLayout[] = [];

export default function App() {
  const [tabs, setTabs] = useState<OpenDocument[]>([]);
  const [closedDocuments, setClosedDocuments] = useState<DocumentEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const {
    selection, setSelection, aiSelection, aiTaskVersion, aiTaskContext,
    aiVisible, setAiVisible, openForSelection, openFromTopbar,
  } = useAiTaskController();
  const [specialSelectionMode, setSpecialSelectionMode] = useState(loadSpecialSelectionMode);
  const [filter, setFilter] = useState("");
  const [libraryVisible, setLibraryVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("就绪");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [scanningWorkspace, setScanningWorkspace] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [renamingTabPath, setRenamingTabPath] = useState<string | null>(null);
  const [tabRenameValue, setTabRenameValue] = useState("");
  const [documentStatistics, setDocumentStatistics] = useState<WritingStatistics>({ words: 0, characters: 0, lines: 0, paragraphs: 0, readingMinutes: 0 });
  const [recoveryDrafts, setRecoveryDrafts] = useState<CrashDraft[]>([]);
  const recentRecords = useRecentRecords();
  const recoveryDraft = recoveryDrafts[0] ?? null;
  const [navigatorMode, setNavigatorMode] = useState<"quick" | "search" | null>(null);
  const layout = useRef<WorkspaceLayout>({ version: 2, documents: {}, images: {} });
  const layoutVersions = useRef<Record<string, number>>({});
  const persistedLayoutVersions = useRef<Record<string, number>>({});
  const [layoutRevision, setLayoutRevision] = useState(0);
  const { rememberWorkspace, rememberFile } = recentRecords;
  const {
    workspace, documents, directories, sessionReady, refreshDocuments,
    openDocument, activateWorkspace, openWorkspace, loadOpenedMarkdown, openSingleMarkdown,
  } = useWorkspaceController({
    tabs, setTabs, setClosedDocuments, activePath, setActivePath, setSelection,
    setLibraryVisible, setAiVisible, setStatus, setWorkspaceError, setScanningWorkspace,
    setRecoveryDrafts, layout, rememberWorkspace, rememberFile,
  });
  const activeDocument = useMemo(() => tabs.find((tab) => tab.path === activePath) ?? null, [tabs, activePath]);
  const focusMode = !libraryVisible && !aiVisible;
  useCrashDraftPersistence(sessionReady, tabs, workspace, recoveryDrafts.map((draft) => draft.path));

  const updateActiveDocument = (content: string, documentJson: TiptapNode | null) => {
    if (!activePath) return;
    setTabs((current) => current.map((tab) => tab.path === activePath ? { ...tab, content, documentJson } : tab));
    layoutVersions.current[activePath] = (layoutVersions.current[activePath] ?? 0) + 1;
    setLayoutRevision((current) => current + 1);
    setStatus("未保存");
  };

  const openAiForSelection = () => {
    openForSelection(workspace, activeDocument);
  };

  const openAiFromTopbar = () => {
    openFromTopbar(workspace, activeDocument);
  };

  const updateSpecialSelectionMode = (mode: SpecialSelectionMode) => {
    setSpecialSelectionMode(mode);
    saveSpecialSelectionMode(mode);
  };

  const toggleFocusMode = () => {
    if (focusMode) {
      if (workspace) setLibraryVisible(true);
      return;
    }
    setLibraryVisible(false);
    setAiVisible(false);
  };

  useEffect(() => {
    setSelection("");
  }, [activePath]);

  useEffect(() => {
    if (!workspace || !activeDocument || activeDocument.saving) return;
    const contentChanged = activeDocument.content !== activeDocument.savedContent;
    const layoutVersion = layoutVersions.current[activeDocument.path] ?? 0;
    const layoutChanged = layoutVersion > (persistedLayoutVersions.current[activeDocument.path] ?? 0);
    if (!contentChanged && !layoutChanged) return;
    const timer = window.setTimeout(async () => {
      const path = activeDocument.path;
      setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, saving: true } : tab));
      setStatus("正在保存…");
      try {
        const modifiedMs = contentChanged
          ? await writeDocument(path, activeDocument.content, activeDocument.modifiedMs)
          : activeDocument.modifiedMs;
        setTabs((current) => current.map((tab) => tab.path === path ? {
          ...tab,
          savedContent: contentChanged ? tab.content : tab.savedContent,
          modifiedMs,
          saving: false,
        } : tab));
        if (activeDocument.documentJson) {
          layout.current.documents[activeDocument.relativePath] = extractTableLayouts(activeDocument.documentJson);
          layout.current.images[activeDocument.relativePath] = extractImageLayouts(activeDocument.documentJson);
          await saveLayout(workspace, JSON.stringify(layout.current, null, 2));
        }
        persistedLayoutVersions.current[path] = layoutVersion;
        setStatus("已保存");
        if (contentChanged) void reindexWorkspace(workspace);
      } catch (reason) {
        persistedLayoutVersions.current[path] = layoutVersion;
        setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, saving: false } : tab));
        const message = String(reason);
        if (message.includes("其他程序修改")) setConflict(path);
        setStatus(message);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeDocument, layoutRevision, workspace]);

  useEffect(() => {
    if (!activeDocument) return;
    const timer = window.setInterval(async () => {
      try {
        const disk = await readDocument(activeDocument.path);
        if (disk.modifiedMs === activeDocument.modifiedMs) return;
        if (activeDocument.content === activeDocument.savedContent) {
          setTabs((current) => current.map((tab) => tab.path === activeDocument.path ? { ...tab, ...disk, savedContent: disk.content } : tab));
          setStatus("已载入外部修改");
        } else {
          setConflict(activeDocument.path);
        }
      } catch {
        // A transient read failure is surfaced when the user next saves.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeDocument]);

  const reloadConflict = async () => {
    if (!conflict) return;
    const loaded = await readDocument(conflict);
    setTabs((current) => current.map((tab) => tab.path === conflict ? { ...tab, ...loaded, savedContent: loaded.content } : tab));
    setConflict(null);
  };

  const saveConflictCopy = async () => {
    if (!workspace || !activeDocument) return;
    const relative = `冲突副本-${titleFromPath(activeDocument.path)}-${Date.now()}`;
    const path = await createDocument(workspace, relative);
    await writeDocument(path, activeDocument.content);
    setConflict(null);
    await refreshDocuments(workspace);
  };

  const recoverCrashDraft = async () => {
    if (!workspace || !recoveryDraft) return;
    const safeTitle = titleFromPath(recoveryDraft.path).replace(/[/\\]/g, "-");
    const occupied = new Set(documents.map((document) => document.relativePath));
    let suffix = 1;
    let relativePath = `恢复草稿-${safeTitle}.md`;
    while (occupied.has(relativePath)) {
      suffix += 1;
      relativePath = `恢复草稿-${safeTitle}-${suffix}.md`;
    }
    try {
      const path = await createDocument(workspace, relativePath);
      await writeDocument(path, recoveryDraft.content);
      removeCrashDraft(recoveryDraft.path);
      setRecoveryDrafts((current) => current.filter((draft) => draft.path !== recoveryDraft.path));
      const entries = await refreshDocuments(workspace);
      const entry = entries.find((document) => document.path === path);
      if (entry) await openDocument(entry);
      setStatus("草稿已恢复为新文档，原文未修改");
    } catch (reason) {
      setStatus(`草稿恢复失败：${String(reason)}`);
    }
  };

  const discardCrashDraft = () => {
    if (!recoveryDraft) return;
    removeCrashDraft(recoveryDraft.path);
    setRecoveryDrafts((current) => current.filter((draft) => draft.path !== recoveryDraft.path));
    setStatus("已忽略崩溃草稿");
  };

  const newDocument = async (folder = "") => {
    if (!workspace) return;
    const relativePath = nextUntitledDocumentPath(documents, folder);
    setStatus(`正在新建 ${relativePath}…`);
    try {
      const path = await createDocument(workspace, relativePath);
      const entries = await refreshDocuments(workspace);
      const entry = entries.find((document) => document.path === path);
      if (entry) await openDocument(entry);
    } catch (reason) {
      setStatus(String(reason));
    }
  };

  const saveDocumentNow = async (document: OpenDocument): Promise<OpenDocument> => {
    if (!workspace || document.content === document.savedContent) return document;
    setStatus("正在保存…");
    const modifiedMs = await writeDocument(document.path, document.content, document.modifiedMs);
    const saved = { ...document, savedContent: document.content, modifiedMs, saving: false };
    setTabs((current) => current.map((tab) => tab.path === document.path ? saved : tab));
    if (document.documentJson) {
      layout.current.documents[document.relativePath] = extractTableLayouts(document.documentJson);
      layout.current.images[document.relativePath] = extractImageLayouts(document.documentJson);
      try {
        await saveLayout(workspace, JSON.stringify(layout.current, null, 2));
      } catch (reason) {
        setStatus(`文档已保存，但表格布局未保存：${String(reason)}`);
      }
    }
    return saved;
  };

  const saveActiveDocument = async () => {
    if (!activeDocument) return;
    try {
      await saveDocumentNow(activeDocument);
      setStatus("已保存");
    } catch (reason) {
      setStatus(`保存失败：${String(reason)}`);
    }
  };

  const saveActiveDocumentAs = async () => {
    if (!activeDocument) return;
    try {
      const destination = await chooseMarkdownSavePath(`${activeDocument.title}.md`);
      if (!destination) {
        setStatus("已取消另存为");
        return;
      }
      await writeMarkdownCopy(destination.path, activeDocument.content);
      await loadOpenedMarkdown(destination);
      setStatus("已另存并打开新文档");
    } catch (reason) {
      setStatus(`另存为失败：${String(reason)}`);
    }
  };

  const closeTab = async (document: OpenDocument) => {
    try {
      await saveDocumentNow(document);
      setClosedDocuments((current) => [document, ...current.filter((entry) => entry.path !== document.path)].slice(0, 20));
      setTabs((current) => {
        const closingIndex = current.findIndex((tab) => tab.path === document.path);
        const remaining = current.filter((tab) => tab.path !== document.path);
        if (activePath === document.path) {
          setActivePath(remaining[Math.min(closingIndex, remaining.length - 1)]?.path ?? null);
        }
        return remaining;
      });
      setStatus("已关闭标签");
    } catch (reason) {
      setStatus(`保存失败，标签未关闭：${String(reason)}`);
    }
  };

  const reopenLastClosed = useCallback(async () => {
    const document = closedDocuments[0];
    if (!document) return;
    try {
      await openDocument(document);
      setClosedDocuments((current) => current.filter((entry) => entry.path !== document.path));
      setStatus("已恢复关闭的标签");
    } catch (reason) {
      setStatus(`无法恢复标签：${String(reason)}`);
    }
  }, [closedDocuments, openDocument]);

  useAppShortcuts({
    workspace,
    save: () => void saveActiveDocument(),
    saveAs: () => void saveActiveDocumentAs(),
    reopenClosed: () => void reopenLastClosed(),
    setNavigatorMode,
  });

  const relocateDocument = async (document: DocumentEntry, destinationFolder: string, newName?: string) => {
    if (!workspace) return;
    const open = tabs.find((tab) => tab.path === document.path);
    try {
      if (open) await saveDocumentNow(open);
      const fileName = `${(newName ?? document.title).replace(/\.md$/i, "")}.md`;
      if (!fileName.trim() || /[/\\]/.test(fileName)) {
        setStatus("文件名不能包含路径分隔符");
        return;
      }
      const destinationRelativePath = destinationFolder ? `${destinationFolder}/${fileName}` : fileName;
      if (destinationRelativePath === document.relativePath) return;
      setStatus("正在移动文档…");
      const moved = await moveDocument(workspace, document.relativePath, destinationRelativePath);
      const savedLayouts = layout.current.documents[document.relativePath];
      const savedImageLayouts = layout.current.images[document.relativePath];
      delete layout.current.documents[document.relativePath];
      delete layout.current.images[document.relativePath];
      if (savedLayouts) layout.current.documents[moved.relativePath] = savedLayouts;
      if (savedImageLayouts) layout.current.images[moved.relativePath] = savedImageLayouts;
      setTabs((current) => current.map((tab) => tab.path === document.path ? { ...tab, ...moved } : tab));
      setActivePath((current) => current === document.path ? moved.path : current);
      try {
        await saveLayout(workspace, JSON.stringify(layout.current, null, 2));
        setStatus("文档已移动");
      } catch (reason) {
        setStatus(`文档已移动，但表格布局未保存：${String(reason)}`);
      }
      await refreshDocuments(workspace);
    } catch (reason) {
      setStatus(String(reason));
    }
  };

  const renameDocument = (document: DocumentEntry, name: string) => {
    void relocateDocument(document, parentFolder(document.relativePath), name);
  };

  const moveDocumentToFolder = (document: DocumentEntry, folder: string) => {
    void relocateDocument(document, folder);
  };

  const removeDocument = async (document: DocumentEntry) => {
    if (!workspace) return;
    const open = tabs.find((tab) => tab.path === document.path);
    try {
      if (open) await saveDocumentNow(open);
      await trashDocument(workspace, document.relativePath);
      const remaining = tabs.filter((tab) => tab.path !== document.path);
      setTabs(remaining);
      if (activePath === document.path) {
        const deletedIndex = tabs.findIndex((tab) => tab.path === document.path);
        setActivePath(remaining[Math.min(deletedIndex, remaining.length - 1)]?.path ?? null);
      }
      delete layout.current.documents[document.relativePath];
      delete layout.current.images[document.relativePath];
      try {
        await saveLayout(workspace, JSON.stringify(layout.current, null, 2));
        setStatus("文档已移入废纸篓");
      } catch (reason) {
        setStatus(`文档已移入废纸篓，但表格布局未更新：${String(reason)}`);
      }
      await refreshDocuments(workspace);
    } catch (reason) {
      setStatus(String(reason));
    }
  };

  const duplicateDocumentFile = async (document: DocumentEntry) => {
    if (!workspace) return;
    try {
      const open = tabs.find((tab) => tab.path === document.path);
      if (open) await saveDocumentNow(open);
      const destination = nextDuplicateDocumentPath(documents, document);
      const copied = await duplicateDocument(workspace, document.relativePath, destination);
      await refreshDocuments(workspace);
      await openDocument(copied);
      setStatus("已创建文档副本");
    } catch (reason) {
      setStatus(`创建副本失败：${String(reason)}`);
    }
  };

  const copyDocumentPath = (document: DocumentEntry) => {
    void copyPlainText(document.path)
      .then(() => setStatus("已复制文档路径"))
      .catch((reason) => setStatus(`复制路径失败：${String(reason)}`));
  };

  const revealDocument = (document: DocumentEntry) => {
    if (!workspace) return;
    void revealDocumentInFinder(workspace, document.relativePath)
      .catch((reason) => setStatus(`无法在访达中显示：${String(reason)}`));
  };

  const { createFolder: createWorkspaceFolder, relocateFolder, removeFolder } = useFolderOperations({
    workspace, tabs, activeDocument, setTabs, setClosedDocuments, setActivePath, layout,
    saveDocument: saveDocumentNow, refreshDocuments, setStatus,
  });

  const finishTabRename = (tab: OpenDocument) => {
    const name = tabRenameValue.trim().replace(/\.md$/i, "");
    setRenamingTabPath(null);
    if (name && name !== tab.title) renameDocument(tab, name);
  };

  const openPath = async (path: string) => {
    const entry = documents.find((document) => document.path === path) ?? {
      path,
      relativePath: path.replace(`${workspace}/`, ""),
      title: titleFromPath(path),
      modifiedMs: 0,
    };
    await openDocument(entry);
  };

  const recentActions = useRecentActions({ activateWorkspace, loadOpenedMarkdown,
    setError: setWorkspaceError, setScanning: setScanningWorkspace, setStatus });

  return (
    <main className={`app-shell${libraryVisible ? " library-visible" : ""}${aiVisible ? " ai-visible" : ""}`}>
      {libraryVisible && <FileSidebar workspace={workspace} documents={documents} directories={directories} activePath={activePath} search={filter} onSearch={setFilter} onOpenWorkspace={() => void openWorkspace()} onOpenDocument={(entry) => void openDocument(entry)} onCreateDocument={(folder) => void newDocument(folder)} onRenameDocument={renameDocument} onMoveDocument={moveDocumentToFolder} onTrashDocument={(document) => void removeDocument(document)} onDuplicateDocument={(document) => void duplicateDocumentFile(document)} onCopyPath={copyDocumentPath} onRevealDocument={revealDocument} onCreateFolder={createWorkspaceFolder} onRenameFolder={(folder, name) => void relocateFolder(folder, parentFolder(folder), name)} onMoveFolder={(folder, target) => void relocateFolder(folder, target)} onTrashFolder={(folder) => void removeFolder(folder)} />}
      <section className="writing-area">
        <AppTopbar tabs={tabs} activePath={activePath} renamingPath={renamingTabPath} renameValue={tabRenameValue}
          setActivePath={setActivePath} setRenamingPath={setRenamingTabPath} setRenameValue={setTabRenameValue}
          finishRename={finishTabRename} closeTab={(tab) => void closeTab(tab)} canReopen={Boolean(closedDocuments.length)}
          hasDocument={Boolean(activeDocument)} hasWorkspace={Boolean(workspace)} focusMode={focusMode}
          reopen={() => void reopenLastClosed()} openFile={() => void openSingleMarkdown()}
          save={() => void saveActiveDocument()} saveAs={() => void saveActiveDocumentAs()}
          openQuick={() => setNavigatorMode("quick")} openSearch={() => setNavigatorMode("search")}
          aiVisible={aiVisible} openAi={openAiFromTopbar}
          toggleFocus={toggleFocusMode} exportDocument={() => setExporting(true)} />
        {conflict && <div className="conflict-banner"><span>文件已在其他程序中改变。</span><button onClick={() => void reloadConflict()}>重新加载</button><button onClick={() => void saveConflictCopy()}>保存冲突副本</button></div>}
        {recoveryDraft && <div className="recovery-banner"><span>发现“{titleFromPath(recoveryDraft.path)}”的未保存草稿。</span><button onClick={() => void recoverCrashDraft()}>恢复为新副本</button><button onClick={discardCrashDraft}>忽略</button></div>}
        {workspace && activeDocument ? (
          <EditorPane key={activeDocument.path} workspace={workspace} documentPath={activeDocument.path} markdownText={activeDocument.content}
            tableLayouts={layout.current.documents[activeDocument.relativePath] ?? emptyTableLayouts} imageLayouts={layout.current.images[activeDocument.relativePath] ?? emptyImageLayouts}
            specialSelectionMode={specialSelectionMode}
            onChange={updateActiveDocument} onSelection={setSelection} onOpenAi={openAiForSelection} onStatistics={setDocumentStatistics} />
        ) : (
          <WelcomeScreen workspace={workspace} scanning={scanningWorkspace} documentCount={documents.length}
            error={workspaceError} openWorkspace={() => void openWorkspace()} openFile={() => void openSingleMarkdown()}
            recent={recentRecords.recent} openRecentWorkspace={(path) => void recentActions.openWorkspace(path)}
            openRecentFile={(root, path) => void recentActions.openFile(root, path)}
            removeRecentWorkspace={recentRecords.removeWorkspace} removeRecentFile={recentRecords.removeFile}
            clearRecent={recentRecords.clear} />
        )}
        <StatusBar activeDocument={activeDocument} statistics={documentStatistics} selection={selection} status={status} />
      </section>
      <AiPanel workspace={aiTaskContext.workspace} documentPath={aiTaskContext.documentPath} documentMarkdown={aiTaskContext.documentMarkdown} selection={aiSelection}
        taskVersion={aiTaskVersion} hidden={!aiVisible}
        specialSelectionMode={specialSelectionMode} onSpecialSelectionModeChange={updateSpecialSelectionMode}
        onClose={() => setAiVisible(false)} onOpenDocument={(path) => void openPath(path).catch((reason) => setStatus(`引用文档不可用：${String(reason)}`))} />
      {exporting && activeDocument && workspace && <ExportPanel markdown={activeDocument.content} title={activeDocument.title} workspace={workspace} onClose={() => setExporting(false)} />}
      {navigatorMode && workspace && <WorkspaceNavigator mode={navigatorMode} workspace={workspace} documents={documents} onOpen={(path) => void openPath(path)} onClose={() => setNavigatorMode(null)} />}
    </main>
  );
}
