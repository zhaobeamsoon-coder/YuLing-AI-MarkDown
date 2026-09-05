import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { importAsset, localAssetUrl } from "../lib/api";
import { importImageFiles } from "../lib/editorImage";

export interface MissingImage {
  pos: number;
  source: string;
}

export function useEditorImages(workspace: string, editorRef: RefObject<Editor | null>) {
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<MissingImage | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const replacementPosition = useRef<number | null>(null);

  const importFiles = async (files: Iterable<File>, replacement: number | null = null) => {
    const editor = editorRef.current;
    if (!editor) return;
    setError("");
    try {
      const imported = await importImageFiles(files, (file) => importAsset(workspace, file));
      if (imported.rejected.length) setError(`已忽略 ${imported.rejected.length} 个非图片文件`);
      if (replacement !== null && imported.assets[0]) {
        const { file, asset } = imported.assets[0];
        const node = editor.state.doc.nodeAt(replacement);
        if (node?.type.name === "image") {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(replacement, undefined, {
            ...node.attrs, src: localAssetUrl(asset.absolutePath), markdownSrc: asset.markdownPath,
            alt: node.attrs.alt || file.name,
          }));
          setMissing(null);
        }
        return;
      }
      for (const { file, asset } of imported.assets) {
        editor.commands.insertContent({ type: "image", attrs: {
          src: localAssetUrl(asset.absolutePath), markdownSrc: asset.markdownPath,
          alt: file.name || "图片", title: null, displayWidth: null,
        } });
      }
    } catch (reason) {
      setError(`图片导入失败：${String(reason)}`);
    }
  };

  return { error, setError, missing, setMissing, input, replacementPosition, importFiles };
}

export function useMissingImageListener(editor: Editor | null, setMissing: (value: MissingImage) => void, setError: (value: string) => void) {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onImageError = (event: Event) => {
      const image = event.target instanceof HTMLImageElement ? event.target : null;
      if (!image || !editor.view.dom.contains(image)) return;
      image.classList.add("yuling-image-missing");
      try {
        setMissing({ pos: editor.view.posAtDOM(image, 0), source: image.dataset.markdownSrc ?? image.src ?? "未知图片" });
      } catch {
        setError("图片无法显示，请在源码模式检查路径");
      }
    };
    editor.view.dom.addEventListener("error", onImageError, true);
    return () => editor.view.dom.removeEventListener("error", onImageError, true);
  }, [editor, setError, setMissing]);
}

interface EditorImageBarsProps {
  editor: Editor;
  active: boolean;
  attrs: Record<string, unknown>;
  images: ReturnType<typeof useEditorImages>;
}

export function EditorImageBars({ editor, active, attrs, images }: EditorImageBarsProps) {
  return <>
    {active && <div className="image-editor-bar" role="group" aria-label="图片属性">
      <input aria-label="图片替代文字" placeholder="替代文字" value={String(attrs.alt ?? "")}
        onChange={(event) => editor.chain().focus().updateAttributes("image", { alt: event.target.value }).run()} />
      <input aria-label="图片标题" placeholder="标题" value={String(attrs.title ?? "")}
        onChange={(event) => editor.chain().focus().updateAttributes("image", { title: event.target.value || null }).run()} />
      <input aria-label="图片宽度" type="number" min="80" max="1600" value={Number(attrs.displayWidth ?? 320)}
        onChange={(event) => editor.chain().focus().updateAttributes("image", { displayWidth: Math.max(80, Math.min(1600, Number(event.target.value) || 320)) }).run()} />
    </div>}
    {images.missing && <div className="image-missing-bar" role="alert">
      <span>图片无法显示：{images.missing.source}</span>
      <button onClick={() => { images.replacementPosition.current = images.missing?.pos ?? null; images.input.current?.click(); }}>重新定位图片</button>
      <button aria-label="关闭图片错误" onClick={() => images.setMissing(null)}>×</button>
    </div>}
    {images.error && <div className="image-import-error" role="alert">{images.error}<button aria-label="关闭图片导入错误" onClick={() => images.setError("")}>×</button></div>}
    <input ref={images.input} className="visually-hidden" type="file" accept="image/*" multiple aria-label="选择图片文件"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        const replacement = images.replacementPosition.current;
        images.replacementPosition.current = null;
        event.target.value = "";
        if (files.length) void images.importFiles(files, replacement);
      }} />
  </>;
}
