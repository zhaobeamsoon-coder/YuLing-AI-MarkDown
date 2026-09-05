import { useEffect, useMemo, useRef, useState } from "react";
import type { DocumentEntry } from "../lib/api";
import { buildDocumentTree, folderAncestors, folderPaths, parentFolder, type DocumentSort, type DocumentTreeNode } from "../lib/fileTree";
import yulingLogo from "../../src-tauri/icons/yuling-md-icon.svg";

interface FileSidebarProps {
  workspace: string | null;
  documents: DocumentEntry[];
  directories?: string[];
  activePath: string | null;
  search: string;
  onSearch: (value: string) => void;
  onOpenWorkspace: () => void;
  onOpenDocument: (document: DocumentEntry) => void;
  onCreateDocument: (folder: string) => void;
  onRenameDocument: (document: DocumentEntry, name: string) => void;
  onMoveDocument: (document: DocumentEntry, folder: string) => void;
  onTrashDocument: (document: DocumentEntry) => void;
  onDuplicateDocument?: (document: DocumentEntry) => void;
  onCopyPath?: (document: DocumentEntry) => void;
  onRevealDocument?: (document: DocumentEntry) => void;
  onCreateFolder?: (parent: string, name: string) => Promise<string | null>;
  onRenameFolder?: (folder: string, name: string) => void;
  onMoveFolder?: (folder: string, destinationParent: string) => void;
  onTrashFolder?: (folder: string) => void;
}

interface FileMenu {
  document: DocumentEntry;
  left: number;
  top: number;
}

function SidebarActionChevron({ up = false }: { up?: boolean }) {
  return <span className={`sidebar-action-chevron${up ? " up" : ""}`} aria-hidden="true" />;
}

function CreateIcon({ folder = false }: { folder?: boolean }) {
  return (
    <svg className="sidebar-create-icon" viewBox="0 0 16 16" aria-hidden="true">
      {folder ? <path d="M2 4.5h4l1.2 1.4H14v7H2z" /> : <path d="M3 2.5h7l3 3v8H3z" />}
      <path d="M8 7v4M6 9h4" />
    </svg>
  );
}

export function FileSidebar(props: FileSidebarProps) {
  const [sort, setSort] = useState<DocumentSort>(() => (localStorage.getItem("yuling-document-sort") as DocumentSort | null) ?? "name-asc");
  const visibleDocuments = useMemo(() => props.documents.filter((document) =>
    document.relativePath.toLocaleLowerCase().includes(props.search.toLocaleLowerCase()),
  ), [props.documents, props.search]);
  const tree = useMemo(() => buildDocumentTree(visibleDocuments, props.directories, sort), [props.directories, sort, visibleDocuments]);
  const allTree = useMemo(() => buildDocumentTree(props.documents, props.directories), [props.directories, props.documents]);
  const allFolders = useMemo(() => folderPaths(allTree), [allTree]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState("");
  const [menu, setMenu] = useState<FileMenu | null>(null);
  const [moving, setMoving] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [trashCandidate, setTrashCandidate] = useState<DocumentEntry | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ folder: string; left: number; top: number } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const dragDocument = useRef<DocumentEntry | null>(null);
  const expandTimer = useRef<number | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const allExpanded = allFolders.length > 0 && allFolders.every((folder) => expanded.has(folder));

  useEffect(() => {
    if (creatingFolder) folderInput.current?.focus();
  }, [creatingFolder]);

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || name === "." || name === ".." || /[/\\]/.test(name)) {
      setFolderError("请输入不含路径符号的文件夹名称");
      return;
    }
    const path = selectedFolder ? `${selectedFolder}/${name}` : name;
    if (allFolders.some((folder) => folder.toLocaleLowerCase() === path.toLocaleLowerCase())) {
      setFolderError("同名文件夹已经存在");
      return;
    }
    if (!props.onCreateFolder) {
      setFolderError("当前无法新建文件夹");
      return;
    }
    setFolderBusy(true);
    const error = await props.onCreateFolder(selectedFolder, name);
    setFolderBusy(false);
    if (error) {
      setFolderError(error);
      return;
    }
    setSelectedFolder(path);
    setExpanded((current) => new Set([...current, ...folderAncestors(`${path}/占位.md`), path]));
    setCreatingFolder(false);
    setFolderName("");
    setFolderError(null);
  };

  useEffect(() => {
    if (!props.activePath) return;
    const activeDocument = props.documents.find((document) => document.path === props.activePath);
    if (!activeDocument) return;
    setSelectedFolder(parentFolder(activeDocument.relativePath));
    setExpanded((current) => new Set([...current, ...folderAncestors(activeDocument.relativePath)]));
  }, [props.activePath, props.documents]);

  useEffect(() => {
    if (!props.search) return;
    setExpanded((current) => new Set([...current, ...folderPaths(tree)]));
  }, [props.search, tree]);

  useEffect(() => {
    if (!menu && !folderMenu) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".file-context-menu")) {
        setMenu(null);
        setFolderMenu(null);
        setMoving(false);
      }
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(null);
        setFolderMenu(null);
        setMoving(false);
      }
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeFromEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeFromEscape);
    };
  }, [folderMenu, menu]);

  useEffect(() => () => {
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
  }, []);

  const toggleFolder = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const startRename = (document: DocumentEntry) => {
    setRenamingPath(document.path);
    setRenameValue(document.title);
    setMenu(null);
  };

  const finishRename = (document: DocumentEntry) => {
    const name = renameValue.trim().replace(/\.md$/i, "");
    setRenamingPath(null);
    if (name && name !== document.title) props.onRenameDocument(document, name);
  };

  const draggedDocument = (event: React.DragEvent) => {
    const relativePath = event.dataTransfer.getData("application/x-yuling-document");
    return dragDocument.current ?? props.documents.find((document) => document.relativePath === relativePath) ?? null;
  };

  const dropInto = (event: React.DragEvent, folder: string) => {
    event.preventDefault();
    if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
    const document = draggedDocument(event);
    dragDocument.current = null;
    if (document && parentFolder(document.relativePath) !== folder) props.onMoveDocument(document, folder);
  };

  const dragOverFolder = (event: React.DragEvent, folder: string) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (!folder || expanded.has(folder) || expandTimer.current !== null) return;
    expandTimer.current = window.setTimeout(() => {
      setExpanded((current) => new Set([...current, folder]));
      expandTimer.current = null;
    }, 500);
  };

  const renderNode = (node: DocumentTreeNode, depth: number): React.ReactNode => {
    if (node.kind === "folder") {
      const isExpanded = expanded.has(node.relativePath);
      return (
        <div className="tree-folder" key={node.relativePath}>
          <button
            className={`tree-row tree-folder-row${selectedFolder === node.relativePath ? " location" : ""}`}
            style={{ paddingLeft: `${8 + depth * 15}px` }}
            aria-expanded={isExpanded}
            aria-current={selectedFolder === node.relativePath ? "location" : undefined}
            onClick={() => {
              setSelectedFolder(node.relativePath);
              toggleFolder(node.relativePath);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setSelectedFolder(node.relativePath);
              setMoving(false);
              setFolderMenu({ folder: node.relativePath, left: event.clientX, top: event.clientY });
            }}
            onDragOver={(event) => dragOverFolder(event, node.relativePath)}
            onDragLeave={() => {
              if (expandTimer.current !== null) window.clearTimeout(expandTimer.current);
              expandTimer.current = null;
            }}
            onDrop={(event) => dropInto(event, node.relativePath)}
          >
            <span className="tree-chevron" aria-hidden="true">{isExpanded ? "⌄" : "›"}</span>
            <span className="tree-folder-icon" aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
            <span className="tree-name">{node.name}</span>
          </button>
          {isExpanded && <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div>}
        </div>
      );
    }
    const isRenaming = renamingPath === node.document.path;
    return (
      <div
        key={node.document.path}
        className={`tree-row tree-file-row ${node.document.path === props.activePath ? "active" : ""}`}
        style={{ paddingLeft: `${28 + depth * 15}px` }}
        aria-current={node.document.path === props.activePath ? "page" : undefined}
        title={node.document.relativePath}
        draggable={!isRenaming}
        onDragStart={(event) => {
          dragDocument.current = node.document;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-yuling-document", node.document.relativePath);
        }}
        onDragEnd={() => { dragDocument.current = null; }}
        onContextMenu={(event) => {
          event.preventDefault();
          setSelectedFolder(parentFolder(node.relativePath));
          setMoving(false);
          setMenu({ document: node.document, left: event.clientX, top: event.clientY });
        }}
        onClick={() => {
          if (isRenaming) return;
          setSelectedFolder(parentFolder(node.relativePath));
          props.onOpenDocument(node.document);
        }}
      >
        <span className="tree-file-icon" aria-hidden="true">◇</span>
        {isRenaming ? (
          <input
            className="tree-rename-input"
            aria-label="重命名文档"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => finishRename(node.document)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename(node.document);
              if (event.key === "Escape") setRenamingPath(null);
            }}
          />
        ) : <span className="tree-name">{node.name}</span>}
      </div>
    );
  };

  return (
    <aside className="file-sidebar">
      <div className="brand-block">
        <img className="brand-mark" src={yulingLogo} alt="" aria-hidden="true" />
        <div><strong>YuLing MD</strong><small>毓灵 Markdown 编辑器</small></div>
      </div>
      {!props.workspace ? (
        <div className="empty-sidebar">
          <p>选择一个文件夹，开始安静写作。</p>
          <button className="primary-button" onClick={props.onOpenWorkspace}>打开文档库</button>
        </div>
      ) : (
        <>
          <div className="sidebar-heading">
            <button
              className={`workspace-location${selectedFolder ? "" : " current"}`}
              title="定位到文档库根目录"
              aria-current={selectedFolder ? undefined : "location"}
              onClick={() => setSelectedFolder("")}
              onDragOver={(event) => dragOverFolder(event, "")}
              onDrop={(event) => dropInto(event, "")}
            >
              {props.workspace.split("/").pop()}
            </button>
            <div className="sidebar-tree-actions">
              <button
                disabled={!allFolders.length}
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(folderPaths(tree)))}
                aria-label={allExpanded ? "折叠全部目录" : "展开全部目录"}
                title={allExpanded ? "折叠全部目录" : "展开全部目录"}
              ><SidebarActionChevron up={allExpanded} /></button>
            </div>
          </div>
          <div className="sidebar-create-actions">
            <button onClick={() => props.onCreateDocument(selectedFolder)} aria-label="新建文档" title={`在${selectedFolder || "文档库根目录"}新建空白文档`}><CreateIcon />文档</button>
            <button onClick={() => { setCreatingFolder(true); setFolderName(""); setFolderError(null); }} aria-label="新建文件夹" title={`在${selectedFolder || "文档库根目录"}新建文件夹`}><CreateIcon folder />文件夹</button>
          </div>
          <input
            className="sidebar-search"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
            placeholder="筛选文档"
          />
          <select className="sidebar-sort" aria-label="文档排序" value={sort} onChange={(event) => {
            const next = event.target.value as DocumentSort;
            setSort(next);
            localStorage.setItem("yuling-document-sort", next);
          }}><option value="name-asc">名称 A–Z</option><option value="name-desc">名称 Z–A</option><option value="modified-desc">最近修改</option><option value="modified-asc">最早修改</option></select>
          <div className="creation-location" title={selectedFolder || "文档库根目录"}>新建位置：{selectedFolder || "文档库根目录"}</div>
          {creatingFolder && (
            <div className="folder-creator">
              <input
                ref={folderInput}
                aria-label="文件夹名称"
                value={folderName}
                disabled={folderBusy}
                placeholder="文件夹名称"
                onChange={(event) => { setFolderName(event.target.value); setFolderError(null); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitFolder();
                  if (event.key === "Escape") { setCreatingFolder(false); setFolderError(null); }
                }}
              />
              <button disabled={folderBusy} aria-label="确认新建文件夹" onClick={() => void submitFolder()}>创建</button>
              <button disabled={folderBusy} aria-label="取消新建文件夹" onClick={() => { setCreatingFolder(false); setFolderError(null); }}>取消</button>
              {folderError && <span role="alert">{folderError}</span>}
            </div>
          )}
          <nav className="document-list" aria-label="文档库">
            {tree.map((node) => renderNode(node, 0))}
            {!tree.length && <p className="tree-empty">没有匹配的 Markdown 文档</p>}
          </nav>
          <button className="change-workspace" onClick={props.onOpenWorkspace}>切换文档库</button>
        </>
      )}
      {menu && (
        <div className="file-context-menu" role="menu" style={{ left: menu.left, top: menu.top }}>
          <button role="menuitem" onClick={() => startRename(menu.document)}>重命名</button>
          <button role="menuitem" onClick={() => { props.onDuplicateDocument?.(menu.document); setMenu(null); }}>创建副本</button>
          <button role="menuitem" onClick={() => { props.onCopyPath?.(menu.document); setMenu(null); }}>复制路径</button>
          <button role="menuitem" onClick={() => { props.onRevealDocument?.(menu.document); setMenu(null); }}>在访达中显示</button>
          <button role="menuitem" aria-expanded={moving} onClick={() => setMoving((value) => !value)}>移动到</button>
          {moving && (
            <div className="file-move-targets">
              <button aria-label="移动到 文档库根目录" onClick={() => { props.onMoveDocument(menu.document, ""); setMenu(null); }}>文档库根目录</button>
              {allFolders.map((folder) => (
                <button key={folder} aria-label={`移动到 ${folder}`} onClick={() => { props.onMoveDocument(menu.document, folder); setMenu(null); }}>{folder}</button>
              ))}
            </div>
          )}
          <button className="destructive" role="menuitem" onClick={() => { setTrashCandidate(menu.document); setMenu(null); }}>移入废纸篓</button>
        </div>
      )}
      {folderMenu && (
        <div className="file-context-menu" role="menu" style={{ left: folderMenu.left, top: folderMenu.top }}>
          <button role="menuitem" onClick={() => {
            const name = window.prompt("新文件夹名称");
            if (name?.trim()) props.onCreateFolder?.(folderMenu.folder, name.trim());
            setFolderMenu(null);
          }}>新建子文件夹</button>
          <button role="menuitem" onClick={() => {
            const currentName = folderMenu.folder.split("/").at(-1) ?? folderMenu.folder;
            const name = window.prompt("重命名文件夹", currentName);
            if (name?.trim() && name.trim() !== currentName) props.onRenameFolder?.(folderMenu.folder, name.trim());
            setFolderMenu(null);
          }}>重命名</button>
          <button role="menuitem" aria-expanded={moving} onClick={() => setMoving((value) => !value)}>移动到</button>
          {moving && <div className="file-move-targets">
            {["", ...allFolders].filter((target) => target !== folderMenu.folder && !target.startsWith(`${folderMenu.folder}/`)).map((target) => (
              <button key={target || "root"} onClick={() => { props.onMoveFolder?.(folderMenu.folder, target); setFolderMenu(null); }}>{target || "文档库根目录"}</button>
            ))}
          </div>}
          <button className="destructive" role="menuitem" onClick={() => {
            if (window.confirm(`将“${folderMenu.folder}”及其内容移入 macOS 废纸篓？`)) props.onTrashFolder?.(folderMenu.folder);
            setFolderMenu(null);
          }}>移入废纸篓</button>
        </div>
      )}
      {trashCandidate && (
        <div className="file-confirm-backdrop" role="presentation">
          <div className="file-confirm" role="alertdialog" aria-modal="true" aria-label="确认删除文档">
            <strong>移入废纸篓？</strong>
            <p>“{trashCandidate.title}.md”可以从 macOS 废纸篓恢复。</p>
            <div>
              <button onClick={() => setTrashCandidate(null)}>取消</button>
              <button className="destructive" onClick={() => { props.onTrashDocument(trashCandidate); setTrashCandidate(null); }}>确认移入废纸篓</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
