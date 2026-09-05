import { useEffect, type Dispatch, type SetStateAction } from "react";

type NavigatorMode = "quick" | "search" | null;

interface AppShortcutOptions {
  workspace: string | null;
  save: () => void;
  saveAs: () => void;
  reopenClosed: () => void;
  setNavigatorMode: Dispatch<SetStateAction<NavigatorMode>>;
}

export function useAppShortcuts(options: AppShortcutOptions): void {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLocaleLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) options.saveAs();
        else options.save();
      } else if (event.shiftKey && key === "t") {
        event.preventDefault();
        options.reopenClosed();
      } else if (key === "p" && options.workspace) {
        event.preventDefault();
        options.setNavigatorMode("quick");
      } else if (event.shiftKey && key === "f" && options.workspace) {
        event.preventDefault();
        options.setNavigatorMode("search");
      } else if (event.key === "Escape") {
        options.setNavigatorMode(null);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [options]);
}
