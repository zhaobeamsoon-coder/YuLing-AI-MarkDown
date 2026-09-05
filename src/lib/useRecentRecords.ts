import { useCallback, useState } from "react";
import {
  clearRecentRecords,
  loadRecentRecords,
  recordRecentFile,
  recordRecentWorkspace,
  removeRecentFile,
  removeRecentWorkspace,
} from "./recent";

export function useRecentRecords() {
  const [recent, setRecent] = useState(loadRecentRecords);
  const rememberWorkspace = useCallback((path: string) => {
    setRecent((current) => recordRecentWorkspace(current, path));
  }, []);
  const rememberFile = useCallback((workspace: string, relativePath: string) => {
    setRecent((current) => recordRecentFile(current, workspace, relativePath));
  }, []);

  return {
    recent,
    rememberWorkspace,
    rememberFile,
    removeWorkspace: (path: string) => setRecent((current) => removeRecentWorkspace(current, path)),
    removeFile: (workspace: string, relativePath: string) => setRecent((current) => removeRecentFile(current, workspace, relativePath)),
    clear: () => setRecent(clearRecentRecords()),
  };
}
