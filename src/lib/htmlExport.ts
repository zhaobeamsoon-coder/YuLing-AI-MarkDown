function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function standaloneHtmlDocument(title: string, bodyHtml: string, css: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || "YuLing 文档")}</title>
<style>${css}</style>
</head>
<body><article class="print-document">${bodyHtml}</article></body>
</html>`;
}

export async function embedLocalImages(
  html: string,
  resolveImage: (source: string) => Promise<string>,
): Promise<string> {
  const document = new DOMParser().parseFromString(`<article>${html}</article>`, "text/html");
  const images = Array.from(document.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    const source = image.getAttribute("src") ?? "";
    if (!source || /^(?:https?:|data:|blob:)/i.test(source)) return;
    image.setAttribute("src", await resolveImage(source));
  }));
  return document.querySelector("article")?.innerHTML ?? html;
}
