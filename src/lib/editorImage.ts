import Image from "@tiptap/extension-image";
import { localAssetUrl } from "./api";

export interface ImportedAsset {
  absolutePath: string;
  markdownPath: string;
  reused: boolean;
}

export async function importImageFiles(
  files: Iterable<File>,
  importer: (file: File) => Promise<ImportedAsset>,
): Promise<{ assets: Array<{ file: File; asset: ImportedAsset }>; rejected: File[] }> {
  const accepted: File[] = [];
  const rejected: File[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) accepted.push(file);
    else rejected.push(file);
  }
  const assets: Array<{ file: File; asset: ImportedAsset }> = [];
  for (const file of accepted) assets.push({ file, asset: await importer(file) });
  return { assets, rejected };
}

export function imageExtension(workspace: string) {
  return Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        markdownSrc: { default: null, rendered: false },
        displayWidth: {
          default: null,
          parseHTML: (element: HTMLElement) => {
            const width = Number.parseInt(element.dataset.yulingImageWidth ?? "", 10);
            return Number.isFinite(width) ? width : null;
          },
          renderHTML: (attributes: { displayWidth?: number | null }) => attributes.displayWidth
            ? { "data-yuling-image-width": attributes.displayWidth, style: `width:${attributes.displayWidth}px;max-width:100%` }
            : {},
        },
      };
    },
    parseMarkdown: (token, helpers) => {
      const source = token.href;
      const absolute = source.startsWith("http") || source.startsWith("data:")
        ? source
        : localAssetUrl(`${workspace}/${source}`);
      return helpers.createNode("image", {
        src: absolute,
        markdownSrc: source,
        title: token.title,
        alt: token.text,
        displayWidth: null,
      });
    },
    renderMarkdown: (node) => {
      const source = node.attrs?.markdownSrc ?? node.attrs?.src ?? "";
      const alt = node.attrs?.alt ?? "";
      const title = node.attrs?.title ?? "";
      return title ? `![${alt}](${source} "${title}")` : `![${alt}](${source})`;
    },
  }).configure({
    allowBase64: false,
    resize: { enabled: true, minWidth: 120, alwaysPreserveAspectRatio: true },
  });
}
