import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

interface HtmlNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

function htmlText(node: HtmlNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(htmlText).join("");
}

function tableOfContentsForExport() {
  return (tree: HtmlNode) => {
    const headings: Array<{ level: number; text: string; id: string }> = [];
    const usedIds = new Map<string, number>();
    const walkHeadings = (node: HtmlNode) => {
      const match = /^h([1-6])$/.exec(node.tagName ?? "");
      if (match) {
        const text = htmlText(node).trim() || "未命名标题";
        const base = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "section";
        const occurrence = usedIds.get(base) ?? 0;
        usedIds.set(base, occurrence + 1);
        const id = occurrence ? `${base}-${occurrence + 1}` : base;
        node.properties = { ...node.properties, id };
        headings.push({ level: Number(match[1]), text, id });
      }
      node.children?.forEach(walkHeadings);
    };
    walkHeadings(tree);

    const replaceMarkers = (node: HtmlNode) => {
      node.children = node.children?.map((child) => {
        if (child.tagName === "p" && htmlText(child).trim().toLocaleLowerCase() === "[toc]") {
          return {
            type: "element",
            tagName: "nav",
            properties: { className: ["yuling-table-of-contents"] },
            children: [{
              type: "element",
              tagName: "ol",
              properties: {},
              children: headings.map((heading) => ({
                type: "element",
                tagName: "li",
                properties: { className: [`toc-level-${heading.level}`] },
                children: [{
                  type: "element",
                  tagName: "a",
                  properties: { href: `#user-content-${heading.id}` },
                  children: [{ type: "text", value: heading.text }],
                }],
              })),
            }],
          };
        }
        replaceMarkers(child);
        return child;
      });
    };
    replaceMarkers(tree);
  };
}

const renderer = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(tableOfContentsForExport)
  .use(rehypeSanitize, {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), "nav"],
    attributes: {
      ...defaultSchema.attributes,
      nav: [...(defaultSchema.attributes?.nav ?? []), "className"],
      li: [...(defaultSchema.attributes?.li ?? []), "className"],
    },
  })
  .use(rehypeKatex)
  .use(rehypeStringify);

const pageBreakMarker = "YULINGMD_PAGE_BREAK_71F37A";

export async function markdownToSafeHtml(markdown: string): Promise<string> {
  const marked = markdown.replace(/^[ \t]*<!--\s*yuling:pagebreak\s*-->[ \t]*$/gim, `\n${pageBreakMarker}\n`);
  return String(await renderer.process(marked)).replaceAll(
    `<p>${pageBreakMarker}</p>`,
    '<div class="yuling-page-break" aria-hidden="true"></div>',
  );
}

export async function renderMermaidInHtml(html: string): Promise<string> {
  if (typeof DOMParser === "undefined" || !html.includes("language-mermaid")) return html;
  const document = new DOMParser().parseFromString(`<article>${html}</article>`, "text/html");
  const blocks = Array.from(document.querySelectorAll<HTMLElement>("pre > code.language-mermaid"));
  if (!blocks.length) return html;
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
  for (const [index, block] of blocks.entries()) {
    try {
      const rendered = await mermaid.render(`yuling-mermaid-${index}-${Date.now()}`, block.textContent ?? "");
      const wrapper = document.createElement("figure");
      wrapper.className = "mermaid-diagram";
      wrapper.innerHTML = rendered.svg;
      block.parentElement?.replaceWith(wrapper);
    } catch {
      block.parentElement?.setAttribute("data-mermaid-error", "true");
    }
  }
  return document.querySelector("article")?.innerHTML ?? html;
}

export function frontmatterEnvelope(markdown: string): { frontmatter: string; body: string } {
  if (!markdown.startsWith("---\n")) return { frontmatter: "", body: markdown };
  const end = markdown.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: "", body: markdown };
  return {
    frontmatter: markdown.slice(0, end + 5),
    body: markdown.slice(end + 5),
  };
}

export function joinFrontmatter(frontmatter: string, body: string): string {
  if (!frontmatter) return body;
  return `${frontmatter}${body.replace(/^\n+/, "")}`;
}

export function isLocalEditorEcho(incoming: string, lastLocalEmission: string | null): boolean {
  return lastLocalEmission !== null && incoming === lastLocalEmission;
}

export function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^\s*<!--\s*yuling:pagebreak\s*-->\s*$/gim, "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*+-]+\s*/gm, "")
    .replace(/[`_$~]/g, "")
    .trim();
}
