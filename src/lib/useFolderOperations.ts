import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { OpenDocument } from "../App";
import { createDirectory, moveDirectory, saveLayout, trashDirectory } from "./api";
import type { WorkspaceLayout } from "./tableLayout";
import type { DocumentEntry } from "./api";

export function useFolderOperations(options: {
  workspace: string | null;
  tabs: OpenDocument[];
  activeDocument: OpenDocument | null;
  setTabs: Dispatch<SetStateAction<OpenDocument[]>>;
  setClosedDocuments: Dispatch<SetStateAction<DocumentEntry[]>>;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  layout: MutableRefObject<WorkspaceLayout>;
  saveDocument: (document: OpenDocument) => Promise<OpenDocument>;
  refreshDocuments: (workspace: string) => Promise<unknown>;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  const createFolder = async (parent: string, name: string) => {
    if (!options.workspace) return "请先打开文档库";
    if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
      options.setStatus("文件夹名称不能包含路径分隔符");
      return "文件夹名称不能包含路径分隔符";
    }
    try {
      await createDirectory(options.workspace, parent ? `${parent}/${name}` : name);
      await options.refreshDocuments(options.workspace);
      options.setStatus("已新建文件夹");
      return null;
    } catch (reason) {
      const error = `新建文件夹失败：${String(reason)}`;
      options.setStatus(error);
      return error;
    }
  };

  const relocateFolder = async (source: string, destinationParent: string, renamed?: string) => {
    const workspace = options.workspace;
    if (!workspace) return;
    const name = renamed ?? source.split("/").at(-1) ?? source;
    if (!name || /[/\\]/.test(name)) return;
    const destination = destinationParent ? `${destinationParent}/${name}` : name;
    if (destination === source) return;
    try {
      const affected = options.tabs.filter((tab) => tab.relativePath.startsWith(`${source}/`));
      for (const tab of affected) await options.saveDocument(tab);
      await moveDirectory(workspace, source, destination);
      options.setTabs((current) => current.map((tab) => {
        if (!tab.relativePath.startsWith(`${source}/`)) return tab;
        const relativePath = `${destination}${tab.relativePath.slice(source.length)}`;
        return { ...tab, relativePath, path: `${workspace}/${relativePath}` };
      }));
      options.setActivePath((current) => current?.startsWith(`${workspace}/${source}/`)
        ? `${workspace}/${destination}${current.slice(`${workspace}/${source}`.length)}` : current);
      options.setClosedDocuments((current) => current.map((document) => {
        if (!document.relativePath.startsWith(`${source}/`)) return document;
        const relativePath = `${destination}${document.relativePath.slice(source.length)}`;
        return { ...document, relativePath, path: `${workspace}/${relativePath}` };
      }));
      Object.keys(options.layout.current.documents).filter((path) => path.startsWith(`${source}/`)).forEach((path) => {
        const next = `${destination}${path.slice(source.length)}`;
        options.layout.current.documents[next] = options.layout.current.documents[path];
        delete options.layout.current.documents[path];
      });
      Object.keys(options.layout.current.images).filter((path) => path.startsWith(`${source}/`)).forEach((path) => {
        const next = `${destination}${path.slice(source.length)}`;
        options.layout.current.images[next] = options.layout.current.images[path];
        delete options.layout.current.images[path];
      });
      await saveLayout(workspace, JSON.stringify(options.layout.current, null, 2));
      await options.refreshDocuments(workspace);
      options.setStatus("文件夹已移动");
    } catch (reason) {
      options.setStatus(`移动文件夹失败：${String(reason)}`);
    }
  };

  const removeFolder = async (folder: string) => {
    const workspace = options.workspace;
    if (!workspace) return;
    try {
      const affected = options.tabs.filter((tab) => tab.relativePath.startsWith(`${folder}/`));
      for (const tab of affected) await options.saveDocument(tab);
      await trashDirectory(workspace, folder);
      options.setTabs((current) => current.filter((tab) => !tab.relativePath.startsWith(`${folder}/`)));
      if (options.activeDocument?.relativePath.startsWith(`${folder}/`)) options.setActivePath(null);
      await options.refreshDocuments(workspace);
      options.setStatus("文件夹已移入废纸篓");
    } catch (reason) {
      options.setStatus(`删除文件夹失败：${String(reason)}`);
    }
  };

  return { createFolder, relocateFolder, removeFolder };
}
