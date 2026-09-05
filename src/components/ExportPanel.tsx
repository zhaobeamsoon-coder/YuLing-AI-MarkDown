import { useEffect, useRef, useState } from "react";
import { Previewer } from "pagedjs";
import { toPng } from "html-to-image";
import { capturePdfPage, chooseHtmlPath, chooseImagePath, choosePdfPath, copyRichHtml, localAssetUrl, mergePdfPages, saveCredential, uploadAssets, writeExportHtml, writeExportImage, type ObjectStorageConfig } from "../lib/api";
import { markdownToSafeHtml, plainTextFromMarkdown, renderMermaidInHtml } from "../lib/markdown";
import { embedLocalImages, standaloneHtmlDocument } from "../lib/htmlExport";
import { buildPrintCss, defaultPrintSettings, type PrintSettings } from "../lib/printSettings";

interface ExportPanelProps {
  markdown: string;
  title: string;
  workspace: string;
  onClose: () => void;
}

const defaultStorage: ObjectStorageConfig = {
  kind: "s3",
  endpoint: "https://example.r2.cloudflarestorage.com",
  bucket: "yuling-images",
  region: "auto",
  publicBaseUrl: "https://images.example.com",
  credentialName: "storage.default",
};

function loadStorage(): ObjectStorageConfig {
  try { return { ...defaultStorage, ...JSON.parse(localStorage.getItem("yuling-storage-settings") ?? "{}") }; }
  catch { return defaultStorage; }
}

export function ExportPanel({ markdown, title, workspace, onClose }: ExportPanelProps) {
  const preview = useRef<HTMLDivElement>(null);
  const previewGeneration = useRef(0);
  const longImageSource = useRef<HTMLElement>(null);
  const [html, setHtml] = useState("");
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");
  const [printSettings, setPrintSettings] = useState<PrintSettings>(() => {
    try { return { ...defaultPrintSettings, ...JSON.parse(localStorage.getItem("yuling-print-settings") ?? "{}") }; }
    catch { return defaultPrintSettings; }
  });
  const [printSettingsOpen, setPrintSettingsOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState("");
  const [storage, setStorage] = useState(loadStorage);
  const [storageSettingsOpen, setStorageSettingsOpen] = useState(false);
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    const generation = ++previewGeneration.current;
    void markdownToSafeHtml(markdown).then(renderMermaidInHtml).then(async (safeHtml) => {
      if (cancelled || generation !== previewGeneration.current || !preview.current) return;
      const nextPreview = document.createElement("div");
      const css = buildPrintCss(printSettings, title);
      const flow = await new Previewer().preview(`<article class="print-document">${safeHtml}</article>`, [{ type: "text/css", text: css }], nextPreview);
      if (cancelled || generation !== previewGeneration.current || !preview.current) return;
      preview.current.replaceChildren(...Array.from(nextPreview.childNodes));
      setHtml(safeHtml);
      setPages(flow.total);
    }).catch((reason) => {
      if (!cancelled && generation === previewGeneration.current) setError(String(reason));
    });
    return () => { cancelled = true; };
  }, [markdown, printSettings, title]);

  useEffect(() => {
    localStorage.setItem("yuling-print-settings", JSON.stringify(printSettings));
  }, [printSettings]);

  const copyForSocial = async () => {
    const localImages = [...markdown.matchAll(/!\[[^\]]*\]\((?!https?:|data:)([^)]+)\)/g)].map((match) => match[1]);
    let richHtml = html;
    try {
      if (localImages.length) {
        setExportProgress(`正在上传 ${localImages.length} 张图片…`);
        const uploaded = await uploadAssets(workspace, [...new Set(localImages)], storage);
        const document = new DOMParser().parseFromString(`<article>${html}</article>`, "text/html");
        for (const image of Array.from(document.querySelectorAll("img"))) {
          const replacement = uploaded.find((item) => item.markdownPath === image.getAttribute("src"));
          if (replacement) image.setAttribute("src", replacement.publicUrl);
        }
        richHtml = document.querySelector("article")?.innerHTML ?? html;
      }
      await copyRichHtml(`<article style="font-size:16px;line-height:1.75;color:#262925">${richHtml}</article>`, plainTextFromMarkdown(markdown));
      setError("");
      setExportProgress("已复制富文本，可粘贴到公众号或小红书编辑器");
    } catch (reason) {
      setExportProgress("");
      setError(`图片上传或复制失败，未写入剪贴板：${String(reason)}`);
    }
  };

  const persistStorage = async () => {
    localStorage.setItem("yuling-storage-settings", JSON.stringify(storage));
    if (accessKeyId && secretAccessKey) {
      await saveCredential(storage.credentialName, JSON.stringify({ accessKeyId, secretAccessKey }));
      setAccessKeyId("");
      setSecretAccessKey("");
    }
    setStorageSettingsOpen(false);
  };

  const exportPdf = async () => {
    const path = await choosePdfPath(`${title || "YuLing 文档"}.pdf`);
    if (!path) return;
    const pageElements = Array.from(preview.current?.querySelectorAll<HTMLElement>(".pagedjs_page") ?? []);
    if (!pageElements.length || pageElements.length > 200) {
      setError("分页尚未完成，或文档超过 200 页。");
      return;
    }
    const pageSizes = pageElements.map((page) => {
      const rect = page.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    setError("");
    const pagePaths: string[] = [];
    try {
      document.documentElement.classList.add("pdf-capture-active");
      preview.current?.classList.add("capture-mode");
      for (const [index, page] of pageElements.entries()) {
        pageElements.forEach((element) => element.classList.remove("capture-target"));
        page.classList.add("capture-target");
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const size = pageSizes[index];
        const partPath = `${path}.yuling-page-${index + 1}.pdf`;
        pagePaths.push(partPath);
        setExportProgress(`正在生成第 ${index + 1} / ${pageElements.length} 页`);
        await capturePdfPage(partPath, size.width, size.height);
      }
      await mergePdfPages(pagePaths, path);
      setExportProgress(`已导出：${path}`);
    } catch (reason) {
      setError(String(reason));
      setExportProgress("");
    } finally {
      document.documentElement.classList.remove("pdf-capture-active");
      preview.current?.classList.remove("capture-mode");
      pageElements.forEach((element) => element.classList.remove("capture-target"));
    }
  };

  const exportLongImage = async () => {
    const path = await chooseImagePath(`${title || "YuLing 文档"}.png`);
    if (!path || !longImageSource.current) return;
    setError("");
    try {
      const height = longImageSource.current.scrollHeight;
      if (height <= 16000) {
        setExportProgress("正在生成长图…");
        const dataUrl = await toPng(longImageSource.current, { pixelRatio: 2, backgroundColor: "#ffffff" });
        const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
        await writeExportImage(path, bytes);
        setExportProgress(`已导出：${path}`);
        return;
      }
      const pageElements = Array.from(preview.current?.querySelectorAll<HTMLElement>(".pagedjs_page") ?? []);
      for (const [index, page] of pageElements.entries()) {
        setExportProgress(`文档过长，正在生成第 ${index + 1} / ${pageElements.length} 张图片`);
        const dataUrl = await toPng(page, { pixelRatio: 2, backgroundColor: "#ffffff" });
        const bytes = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
        const partPath = path.replace(/\.png$/i, `-${String(index + 1).padStart(2, "0")}.png`);
        await writeExportImage(partPath, bytes);
      }
      setExportProgress(`文档超过单图上限，已导出 ${pageElements.length} 张编号图片`);
    } catch (reason) {
      setExportProgress("");
      setError(`长图导出失败：${String(reason)}`);
    }
  };

  const exportHtml = async () => {
    const path = await chooseHtmlPath(`${title || "YuLing 文档"}.html`);
    if (!path) return;
    setError("");
    setExportProgress("正在生成独立 HTML…");
    try {
      const currentHtml = await markdownToSafeHtml(markdown).then(renderMermaidInHtml);
      const embedded = await embedLocalImages(currentHtml, async (source) => {
        const response = await fetch(localAssetUrl(`${workspace}/${decodeURIComponent(source)}`));
        if (!response.ok) throw new Error(`无法读取图片：${source}`);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error(`无法读取图片：${source}`));
          reader.readAsDataURL(blob);
        });
      });
      await writeExportHtml(path, standaloneHtmlDocument(title, embedded, buildPrintCss(printSettings, title)));
      setExportProgress(`已导出：${path}`);
    } catch (reason) {
      setExportProgress("");
      setError(`HTML 导出失败：${String(reason)}`);
    }
  };

  return (
    <div className="export-overlay" role="dialog" aria-modal="true" aria-label="分页与分享">
      <header className="export-header">
        <div><strong>分页与分享</strong><small>{pages ? `${pages} 页` : "正在分页…"}</small></div>
        <div className="export-actions">
          <select value={printSettings.paper} onChange={(event) => setPrintSettings({ ...printSettings, paper: event.target.value as "A4" | "Letter" })}><option value="A4">A4</option><option value="Letter">Letter</option></select>
          <button onClick={() => setPrintSettingsOpen((value) => !value)}>页面设置</button>
          <button onClick={() => setStorageSettingsOpen((value) => !value)}>图床设置</button>
          <button onClick={() => void copyForSocial()}>复制到公众号 / 小红书</button>
          <button onClick={() => void exportLongImage()}>导出长图</button>
          <button onClick={() => void exportHtml()}>导出 HTML</button>
          <button onClick={() => window.print()}>系统打印</button>
          <button className="primary-button" onClick={() => void exportPdf()}>导出 PDF</button>
          <button onClick={onClose}>关闭</button>
        </div>
      </header>
      {printSettingsOpen && <div className="print-settings">
        <label>上边距（mm）<input type="number" min="5" max="50" value={printSettings.marginTop} onChange={(event) => setPrintSettings({ ...printSettings, marginTop: Number(event.target.value) })} /></label>
        <label>右边距（mm）<input type="number" min="5" max="50" value={printSettings.marginRight} onChange={(event) => setPrintSettings({ ...printSettings, marginRight: Number(event.target.value) })} /></label>
        <label>下边距（mm）<input type="number" min="5" max="50" value={printSettings.marginBottom} onChange={(event) => setPrintSettings({ ...printSettings, marginBottom: Number(event.target.value) })} /></label>
        <label>左边距（mm）<input type="number" min="5" max="50" value={printSettings.marginLeft} onChange={(event) => setPrintSettings({ ...printSettings, marginLeft: Number(event.target.value) })} /></label>
        <label>正文字体<select value={printSettings.font} onChange={(event) => setPrintSettings({ ...printSettings, font: event.target.value as PrintSettings["font"] })}><option value="system">系统字体</option><option value="serif">宋体 / 衬线</option><option value="mono">等宽字体</option></select></label>
        <label>页眉<input value={printSettings.header} onChange={(event) => setPrintSettings({ ...printSettings, header: event.target.value })} placeholder="支持 {title}" /></label>
        <label>页脚<input value={printSettings.footer} onChange={(event) => setPrintSettings({ ...printSettings, footer: event.target.value })} placeholder="页码会自动附加" /></label>
      </div>}
      {storageSettingsOpen && <div className="storage-settings">
        <label>类型<select value={storage.kind} onChange={(event) => setStorage({ ...storage, kind: event.target.value as "s3" | "oss" })}><option value="s3">S3 / R2 / MinIO</option><option value="oss">阿里 OSS</option></select></label>
        <label>Endpoint<input value={storage.endpoint} onChange={(event) => setStorage({ ...storage, endpoint: event.target.value })} /></label>
        <label>Bucket<input value={storage.bucket} onChange={(event) => setStorage({ ...storage, bucket: event.target.value })} /></label>
        {storage.kind === "s3" && <label>Region<input value={storage.region ?? "auto"} onChange={(event) => setStorage({ ...storage, region: event.target.value })} /></label>}
        <label>公开 URL 前缀<input value={storage.publicBaseUrl} onChange={(event) => setStorage({ ...storage, publicBaseUrl: event.target.value })} /></label>
        <label>Access Key ID<input value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} /></label>
        <label>Secret Access Key<input type="password" value={secretAccessKey} onChange={(event) => setSecretAccessKey(event.target.value)} /></label>
        <button className="primary-button" onClick={() => void persistStorage()}>保存到 Keychain</button>
      </div>}
      {error && <div className="export-error">{error}</div>}
      {exportProgress && <div className="export-progress">{exportProgress}</div>}
      <div className="paged-preview" ref={preview} />
      <article className="long-image-source" ref={longImageSource} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
