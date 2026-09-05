import type { Dispatch, SetStateAction } from "react";
import type { OpenDocument } from "../App";
import type { WritingStatistics } from "../lib/statistics";
import { countWritingStatistics, formatWritingStatistics } from "../lib/statistics";
import yulingLogo from "../../src-tauri/icons/yuling-md-icon.svg";
import type { RecentRecords } from "../lib/recent";

export function DocumentTabs(props: {
  tabs: OpenDocument[];
  activePath: string | null;
  renamingPath: string | null;
  renameValue: string;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setRenamingPath: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  finishRename: (tab: OpenDocument) => void;
  closeTab: (tab: OpenDocument) => void;
}) {
  return <div className="tabs">{props.tabs.map((tab) => props.renamingPath === tab.path ? (
    <input key={tab.path} className="tab-rename-input" aria-label="重命名当前文档" autoFocus
      value={props.renameValue} onChange={(event) => props.setRenameValue(event.target.value)}
      onBlur={() => props.finishRename(tab)} onKeyDown={(event) => {
        if (event.key === "Enter") props.finishRename(tab);
        if (event.key === "Escape") props.setRenamingPath(null);
      }} />
  ) : (
    <div key={tab.path} className={`tab${tab.path === props.activePath ? " active" : ""}`}>
      <button className="tab-title" onClick={() => {
        if (tab.path !== props.activePath) props.setActivePath(tab.path);
        else {
          props.setRenameValue(tab.title);
          props.setRenamingPath(tab.path);
        }
      }}>{tab.title}{tab.content !== tab.savedContent ? " ·" : ""}</button>
      <button className="tab-close" aria-label={`关闭 ${tab.title}`} title={`关闭 ${tab.title}`} onClick={() => props.closeTab(tab)}>×</button>
    </div>
  ))}</div>;
}

export function AppTopbar(props: {
  tabs: OpenDocument[];
  activePath: string | null;
  renamingPath: string | null;
  renameValue: string;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setRenamingPath: Dispatch<SetStateAction<string | null>>;
  setRenameValue: Dispatch<SetStateAction<string>>;
  finishRename: (tab: OpenDocument) => void;
  closeTab: (tab: OpenDocument) => void;
  canReopen: boolean;
  hasDocument: boolean;
  hasWorkspace: boolean;
  focusMode: boolean;
  aiVisible: boolean;
  reopen: () => void;
  openFile: () => void;
  save: () => void;
  saveAs: () => void;
  openQuick: () => void;
  openSearch: () => void;
  openAi: () => void;
  toggleFocus: () => void;
  exportDocument: () => void;
}) {
  return <header className="topbar">
    <DocumentTabs tabs={props.tabs} activePath={props.activePath} renamingPath={props.renamingPath} renameValue={props.renameValue}
      setActivePath={props.setActivePath} setRenamingPath={props.setRenamingPath} setRenameValue={props.setRenameValue}
      finishRename={props.finishRename} closeTab={props.closeTab} />
    <div className="topbar-actions">
      <button disabled={!props.canReopen} aria-label="恢复关闭的标签" title="恢复关闭的标签（⇧⌘T）" onClick={props.reopen}>↶</button>
      <button onClick={props.openFile}>打开文件</button>
      <button disabled={!props.hasDocument} title="保存（⌘S）" onClick={props.save}>保存</button>
      <button disabled={!props.hasDocument} title="另存为（⇧⌘S）" onClick={props.saveAs}>另存为</button>
      <button disabled={!props.hasWorkspace} title="快速打开（⌘P）" onClick={props.openQuick}>快速打开</button>
      <button disabled={!props.hasWorkspace} title="全文搜索（⇧⌘F）" onClick={props.openSearch}>全文搜索</button>
      {props.hasWorkspace && <button onClick={props.toggleFocus}>{props.focusMode ? "退出专注" : "专注"}</button>}
      <button disabled={!props.hasDocument} aria-label="知了" aria-pressed={props.aiVisible}
        title="打开知了" onClick={props.openAi}>✦ 知了</button>
      <button disabled={!props.hasDocument} onClick={props.exportDocument}>分页 / 分享</button>
    </div>
  </header>;
}

export function WelcomeScreen(props: {
  workspace: string | null;
  scanning: boolean;
  documentCount: number;
  error: string | null;
  openWorkspace: () => void;
  openFile: () => void;
  recent: RecentRecords;
  openRecentWorkspace: (path: string) => void;
  openRecentFile: (workspace: string, relativePath: string) => void;
  removeRecentWorkspace: (path: string) => void;
  removeRecentFile: (workspace: string, relativePath: string) => void;
  clearRecent: () => void;
}) {
  return <div className="welcome-screen">
    <img className="welcome-mark" src={yulingLogo} alt="" aria-hidden="true" />
    <h1>{props.workspace ? "文档库已打开" : "YuLing MD"}</h1>
    <p>{props.workspace
      ? props.scanning ? "正在后台扫描 Markdown 文档…" : `已找到 ${props.documentCount} 篇文档，请在左侧选择一篇。`
      : "安静写作，需要时再唤醒 AI。"}</p>
    {props.error && <p className="workspace-error">{props.error}</p>}
    {!props.workspace && <div className="welcome-actions">
      <button className="primary-button" disabled={props.scanning} onClick={props.openWorkspace}>{props.scanning ? "正在打开…" : "打开 Markdown 文档库"}</button>
      <button disabled={props.scanning} onClick={props.openFile}>打开单个 Markdown</button>
    </div>}
    <div className="recent-records">
      {!props.workspace && props.recent.workspaces.length > 0 && <section aria-label="最近工作区">
        <h2>最近工作区</h2>
        {props.recent.workspaces.map((item) => <div key={item.path} className="recent-row">
          <button onClick={() => props.openRecentWorkspace(item.path)}>{item.path.split("/").at(-1) || item.path}</button>
          <button aria-label={`移除最近工作区 ${item.path}`} onClick={() => props.removeRecentWorkspace(item.path)}>×</button>
        </div>)}
      </section>}
      {props.recent.files.filter((item) => !props.workspace || item.workspace === props.workspace).slice(0, 10).length > 0 && <section aria-label="最近文件">
        <h2>最近文件</h2>
        {props.recent.files.filter((item) => !props.workspace || item.workspace === props.workspace).slice(0, 10).map((item) => <div key={`${item.workspace}/${item.relativePath}`} className="recent-row">
          <button onClick={() => props.openRecentFile(item.workspace, item.relativePath)}>{item.relativePath}</button>
          <button aria-label={`移除最近文件 ${item.relativePath}`} onClick={() => props.removeRecentFile(item.workspace, item.relativePath)}>×</button>
        </div>)}
      </section>}
      {(props.recent.workspaces.length > 0 || props.recent.files.length > 0) && <button className="clear-recent" onClick={props.clearRecent}>清除最近记录</button>}
    </div>
  </div>;
}

export function StatusBar(props: {
  activeDocument: OpenDocument | null;
  statistics: WritingStatistics;
  selection: string;
  status: string;
}) {
  return <footer className="statusbar">
    <span>{props.activeDocument?.relativePath ?? "未打开文档"}</span>
    <span>{props.activeDocument ? formatWritingStatistics(props.statistics, countWritingStatistics(props.selection)) : props.status}</span>
    {props.activeDocument && <span>{props.status}</span>}
  </footer>;
}
