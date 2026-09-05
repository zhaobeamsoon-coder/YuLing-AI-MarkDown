import { useEffect, useMemo, useRef, useState } from "react";
import { searchWorkspace, type DocumentEntry, type SearchResult } from "../lib/api";

interface WorkspaceNavigatorProps {
  mode: "quick" | "search";
  workspace: string;
  documents: DocumentEntry[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function WorkspaceNavigator({ mode, workspace, documents, onOpen, onClose }: WorkspaceNavigatorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const quickResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return documents
      .filter((document) => !normalized || document.relativePath.toLocaleLowerCase().includes(normalized))
      .slice(0, 30);
  }, [documents, query]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    if (mode !== "search" || !query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchWorkspace(workspace, query.trim(), 30)
        .then((matches) => {
          if (!cancelled) setResults(matches);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, query, workspace]);

  const paths = mode === "quick" ? quickResults.map((document) => document.path) : results.map((result) => result.path);
  const openAt = (index: number) => {
    const path = paths[index];
    if (!path) return;
    onOpen(path);
    onClose();
  };

  return (
    <div className="navigator-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="workspace-navigator" role="dialog" aria-label={mode === "quick" ? "快速打开" : "全文搜索"}>
        <input
          ref={input}
          type="search"
          aria-label={mode === "quick" ? "快速打开文档" : "全文搜索"}
          placeholder={mode === "quick" ? "输入文件名或路径…" : "搜索文档正文…"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, Math.max(0, paths.length - 1)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            }
            if (event.key === "Enter") openAt(activeIndex);
          }}
        />
        <div className="navigator-results">
          {mode === "quick" && quickResults.map((document, index) => (
            <button key={document.path} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => openAt(index)}>
              <strong>{document.title}</strong><span>{document.relativePath}</span>
            </button>
          ))}
          {mode === "search" && results.map((result, index) => (
            <button key={result.path} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={() => openAt(index)}>
              <strong>{result.title}</strong><span>{result.excerpt}</span>
            </button>
          ))}
          {mode === "search" && searching && <p>正在搜索…</p>}
          {mode === "search" && query.trim() && !searching && !results.length && <p>没有找到相关内容</p>}
          {mode === "quick" && !quickResults.length && <p>没有匹配的文档</p>}
        </div>
      </section>
    </div>
  );
}
