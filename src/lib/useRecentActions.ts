import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { OpenedMarkdown } from "./api";

export function useRecentActions(options: {
  activateWorkspace: (path: string) => Promise<string>;
  loadOpenedMarkdown: (opened: OpenedMarkdown) => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setScanning: Dispatch<SetStateAction<boolean>>;
  setStatus: Dispatch<SetStateAction<string>>;
}) {
  const openWorkspace = useCallback(async (path: string) => {
    options.setError(null);
    options.setScanning(true);
    try {
      await options.activateWorkspace(path);
    } catch (reason) {
      options.setError(`最近工作区不可用：${String(reason)}`);
      options.setStatus("最近工作区不可用，可从列表移除或重新选择");
    } finally {
      options.setScanning(false);
    }
  }, [options]);
  const openFile = useCallback((workspace: string, relativePath: string) =>
    options.loadOpenedMarkdown({ workspace, path: `${workspace}/${relativePath}` }), [options]);
  return { openWorkspace, openFile };
}
