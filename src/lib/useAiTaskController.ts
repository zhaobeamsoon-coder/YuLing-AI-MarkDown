import { useState } from "react";
import type { OpenDocument } from "./useWorkspaceController";

interface AiTaskContext {
  workspace: string | null;
  documentPath: string | null;
  documentMarkdown: string;
}

export function useAiTaskController() {
  const [selection, setSelection] = useState("");
  const [aiSelection, setAiSelection] = useState("");
  const [aiTaskVersion, setAiTaskVersion] = useState(0);
  const [aiVisible, setAiVisible] = useState(false);
  const [aiTaskContext, setAiTaskContext] = useState<AiTaskContext>({
    workspace: null,
    documentPath: null,
    documentMarkdown: "",
  });

  const openForSelection = (workspace: string | null, activeDocument: OpenDocument | null) => {
    if (!selection.trim() || !workspace || !activeDocument) return;
    setAiSelection(selection);
    setAiTaskContext({
      workspace,
      documentPath: activeDocument.path,
      documentMarkdown: activeDocument.content,
    });
    setAiTaskVersion((current) => current + 1);
    setAiVisible(true);
  };

  const openFromTopbar = (workspace: string | null, activeDocument: OpenDocument | null) => {
    if (aiTaskVersion === 0 && workspace && activeDocument) {
      setAiTaskContext({
        workspace,
        documentPath: activeDocument.path,
        documentMarkdown: activeDocument.content,
      });
    }
    setAiVisible(true);
  };

  return {
    selection, setSelection, aiSelection, aiTaskVersion, aiTaskContext,
    aiVisible, setAiVisible, openForSelection, openFromTopbar,
  };
}
