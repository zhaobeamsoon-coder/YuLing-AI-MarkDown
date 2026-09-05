import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readText, writeHtml, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { watch, type WatchEvent } from "@tauri-apps/plugin-fs";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AiProvider } from "./aiSettings";

export interface DocumentEntry {
  path: string;
  relativePath: string;
  title: string;
  modifiedMs: number;
}

export interface DocumentContent {
  content: string;
  modifiedMs: number;
}

export interface OpenedMarkdown {
  workspace: string;
  path: string;
}

export interface SearchResult {
  path: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface KnowledgeCardInput {
  title: string;
  summary: string;
  concepts: string[];
  sourceDocument: string;
  sourceExcerpt: string;
  relatedDocuments: string[];
}

export interface AiChatRequest {
  requestId: string;
  provider: AiProvider;
  workspace?: string;
  endpoint: string;
  model: string;
  credentialName?: string;
  cliPath?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}

export interface AiConnectionResult {
  ok: boolean;
  message: string;
  errorKind?: string;
  resolvedPath?: string;
  version?: string;
}

export interface CliProbeAttempt {
  path: string;
  outcome: string;
  message: string;
}

export interface CliProbeReport {
  kind: string;
  resolvedPath?: string;
  version?: string;
  attempts: CliProbeAttempt[];
  errorKind?: string;
}

export interface ObjectStorageConfig {
  kind: "s3" | "oss";
  endpoint: string;
  bucket: string;
  region?: string;
  publicBaseUrl: string;
  credentialName: string;
}

export function runningInTauri(): boolean {
  return isTauri();
}

export async function chooseWorkspace(): Promise<string | null> {
  if (!runningInTauri()) return "/演示工作区";
  const path = await open({ directory: true, multiple: false, recursive: true, title: "选择 Markdown 文档库" });
  return typeof path === "string" ? path : null;
}

export async function chooseMarkdownFile(): Promise<OpenedMarkdown | null> {
  if (!runningInTauri()) return null;
  return invoke("choose_markdown_file");
}

export async function takeOpenedMarkdown(): Promise<OpenedMarkdown[]> {
  if (!runningInTauri()) return [];
  return invoke("take_opened_markdown");
}

export async function onOpenedMarkdown(callback: () => void): Promise<UnlistenFn> {
  if (!runningInTauri()) return () => undefined;
  return listen("yuling://opened-markdown", callback);
}

export async function chooseMarkdownSavePath(defaultName: string): Promise<OpenedMarkdown | null> {
  if (!runningInTauri()) return null;
  return invoke("choose_markdown_save_path", { defaultName });
}

export async function writeMarkdownCopy(path: string, content: string): Promise<void> {
  if (!runningInTauri()) throw new Error("另存为需要在 YuLing MD 桌面应用中运行");
  await invoke("write_markdown_copy", { path, content });
}

export async function authorizeWorkspace(path: string): Promise<string> {
  if (!runningInTauri()) return path;
  return invoke("authorize_workspace", { path });
}

const demoMarkdown = `# 欢迎使用 YuLing MD

这是一个安静、即时、低干扰的 Markdown 编辑器。

## 可即时调整的表格

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 中文表格 | 已支持 | 列宽不足时横向滚动，不把文字压成竖列 |
| AI 知了 | 已支持 | 选中文字后可解释、关联、类比与补缺 |
| PDF | 已支持分页预览 | 支持 A4 与 Letter |

> 选择一段文字，然后打开右侧的 AI 知了。
`;

export async function listDocuments(workspace: string): Promise<DocumentEntry[]> {
  if (!runningInTauri()) {
    return [{ path: `${workspace}/欢迎.md`, relativePath: "欢迎.md", title: "欢迎", modifiedMs: 1 }];
  }
  return invoke("list_documents", { workspace });
}

export async function listDirectories(workspace: string): Promise<string[]> {
  if (!runningInTauri()) return [];
  return invoke("list_directories", { workspace });
}

export async function watchWorkspace(
  workspace: string,
  callback: (event: WatchEvent) => void,
): Promise<() => void> {
  if (!runningInTauri()) return () => undefined;
  return watch(workspace, callback, { recursive: true, delayMs: 250 });
}

export async function createDirectory(workspace: string, relativePath: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("create_directory", { workspace, relativePath });
}

export async function moveDirectory(workspace: string, sourceRelativePath: string, destinationRelativePath: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("move_directory", { workspace, sourceRelativePath, destinationRelativePath });
}

export async function trashDirectory(workspace: string, relativePath: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("trash_directory", { workspace, relativePath });
}

export async function readDocument(path: string): Promise<DocumentContent> {
  if (!runningInTauri()) return { content: demoMarkdown, modifiedMs: 1 };
  return invoke("read_document", { path });
}

export async function writeDocument(path: string, content: string, expectedModifiedMs?: number): Promise<number> {
  if (!runningInTauri()) return Date.now();
  return invoke("write_document", { path, content, expectedModifiedMs });
}

export async function createDocument(workspace: string, relativePath: string): Promise<string> {
  if (!runningInTauri()) return `${workspace}/${relativePath}.md`;
  return invoke("create_document", { workspace, relativePath });
}

export async function moveDocument(
  workspace: string,
  sourceRelativePath: string,
  destinationRelativePath: string,
): Promise<DocumentEntry> {
  if (!runningInTauri()) {
    const path = `${workspace}/${destinationRelativePath}`;
    return {
      path,
      relativePath: destinationRelativePath,
      title: destinationRelativePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "未命名",
      modifiedMs: Date.now(),
    };
  }
  return invoke("move_document", { workspace, sourceRelativePath, destinationRelativePath });
}

export async function duplicateDocument(
  workspace: string,
  sourceRelativePath: string,
  destinationRelativePath: string,
): Promise<DocumentEntry> {
  if (!runningInTauri()) {
    return {
      path: `${workspace}/${destinationRelativePath}`,
      relativePath: destinationRelativePath,
      title: destinationRelativePath.split("/").at(-1)?.replace(/\.md$/, "") ?? "副本",
      modifiedMs: Date.now(),
    };
  }
  return invoke("duplicate_document", { workspace, sourceRelativePath, destinationRelativePath });
}

export async function revealDocumentInFinder(workspace: string, relativePath: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("reveal_document_in_finder", { workspace, relativePath });
}

export async function trashDocument(workspace: string, relativePath: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("trash_document", { workspace, relativePath });
}

export async function importAsset(workspace: string, file: File): Promise<{ absolutePath: string; markdownPath: string; reused: boolean }> {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  if (!runningInTauri()) {
    return { absolutePath: URL.createObjectURL(file), markdownPath: URL.createObjectURL(file), reused: false };
  }
  return invoke("import_asset", { workspace, bytes, originalName: file.name || "clipboard.png" });
}

export function localAssetUrl(path: string): string {
  return runningInTauri() ? convertFileSrc(path) : path;
}

export async function reindexWorkspace(workspace: string): Promise<number> {
  if (!runningInTauri()) return 1;
  return invoke("index_workspace", { workspace });
}

export async function searchWorkspace(workspace: string, query: string, limit = 8): Promise<SearchResult[]> {
  if (!runningInTauri()) {
    return [{ path: `${workspace}/欢迎.md`, title: "欢迎", excerpt: `演示结果：${query}`, score: 0 }];
  }
  return invoke("search_workspace", { workspace, query, limit });
}

export async function saveKnowledgeCard(workspace: string, card: KnowledgeCardInput): Promise<string> {
  if (!runningInTauri()) return `${workspace}/知识卡片/${card.title}.md`;
  return invoke("save_knowledge_card", { workspace, card });
}

export async function saveCredential(name: string, secret: string): Promise<void> {
  if (!runningInTauri()) return;
  await invoke("save_credential", { name, secret });
}

export async function hasCredential(name: string): Promise<boolean> {
  if (!runningInTauri()) return false;
  return invoke("has_credential", { name });
}

export async function startAiChat(request: AiChatRequest): Promise<void> {
  if (!runningInTauri()) throw new Error("浏览器演示模式不会发送 AI 请求");
  return invoke("ai_chat", { request });
}

export async function cancelAiChat(requestId: string): Promise<boolean> {
  if (!runningInTauri()) return false;
  return invoke("cancel_ai_chat", { requestId });
}

export async function testAiConnection(request: AiChatRequest): Promise<AiConnectionResult> {
  if (!runningInTauri()) return { ok: false, message: "浏览器演示模式不会连接 AI", errorKind: "connection_failed" };
  return invoke("test_ai_connection", { request });
}

export async function probeAiCli(kind: "claude-cli" | "codex-cli", savedPath?: string, savedOnly = false): Promise<CliProbeReport> {
  if (!runningInTauri()) return { kind, attempts: [], errorKind: "cli_not_found" };
  return invoke("probe_ai_cli", { kind, savedPath, savedOnly });
}

export async function chooseCliExecutable(kind: "claude-cli" | "codex-cli"): Promise<string | null> {
  if (!runningInTauri()) return null;
  const path = await open({ directory: false, multiple: false, title: `选择 ${kind === "claude-cli" ? "Claude" : "Codex"} CLI` });
  return typeof path === "string" ? path : null;
}

export async function loadLayout(workspace: string): Promise<string> {
  if (!runningInTauri()) return '{"version":2,"documents":{},"images":{}}';
  return invoke("load_workspace_layout", { workspace });
}

export async function saveLayout(workspace: string, layoutJson: string): Promise<void> {
  if (!runningInTauri()) return;
  return invoke("save_workspace_layout", { workspace, layoutJson });
}

export async function choosePdfPath(defaultName: string): Promise<string | null> {
  if (!runningInTauri()) return null;
  return invoke("choose_export_path", { defaultName, kind: "pdf" });
}

export async function chooseImagePath(defaultName: string): Promise<string | null> {
  if (!runningInTauri()) return null;
  return invoke("choose_export_path", { defaultName, kind: "png" });
}

export async function chooseHtmlPath(defaultName: string): Promise<string | null> {
  if (!runningInTauri()) return null;
  return invoke("choose_export_path", { defaultName, kind: "html" });
}

export async function writeExportHtml(path: string, html: string): Promise<void> {
  if (!runningInTauri()) throw new Error("HTML 导出需要在 YuLing MD 桌面应用中运行");
  await invoke("write_export_file", { path, bytes: Array.from(new TextEncoder().encode(html)) });
}

export async function writeExportImage(path: string, bytes: Uint8Array): Promise<void> {
  if (!runningInTauri()) throw new Error("图片导出需要在 YuLing MD 桌面应用中运行");
  await invoke("write_export_file", { path, bytes: Array.from(bytes) });
}

export async function capturePdfPage(outputPath: string, width: number, height: number): Promise<void> {
  if (!runningInTauri()) throw new Error("PDF 直接导出需要在 YuLing MD 桌面应用中运行");
  await invoke("capture_pdf_page", { outputPath, width, height });
}

export async function mergePdfPages(pagePaths: string[], outputPath: string): Promise<number> {
  if (!runningInTauri()) throw new Error("PDF 直接导出需要在 YuLing MD 桌面应用中运行");
  return invoke("merge_pdf_pages", { pagePaths, outputPath });
}

export async function uploadAssets(
  workspace: string,
  markdownPaths: string[],
  config: ObjectStorageConfig,
): Promise<Array<{ markdownPath: string; publicUrl: string }>> {
  if (!runningInTauri()) throw new Error("图床上传需要在 YuLing MD 桌面应用中运行");
  return invoke("upload_assets", { workspace, markdownPaths, config });
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!runningInTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await invoke("open_external_url", { url });
}

export async function copyPlainText(text: string): Promise<void> {
  if (runningInTauri()) {
    await writeText(text);
    return;
  }
  await navigator.clipboard?.writeText(text);
}

export async function readPlainText(): Promise<string> {
  if (runningInTauri()) return readText();
  return navigator.clipboard?.readText?.() ?? "";
}

export async function copyRichText(html: string, text: string): Promise<void> {
  if (runningInTauri()) {
    await writeHtml(html, text);
    return;
  }
  await navigator.clipboard?.writeText(text);
}

export async function copyRichHtml(html: string, text: string): Promise<void> {
  if (!runningInTauri()) {
    await navigator.clipboard.writeText(text);
    return;
  }
  await writeHtml(html, text);
}
