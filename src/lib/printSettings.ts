export interface PrintSettings {
  paper: "A4" | "Letter";
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  font: "system" | "serif" | "mono";
  header: string;
  footer: string;
}

export const defaultPrintSettings: PrintSettings = {
  paper: "A4",
  marginTop: 18,
  marginRight: 18,
  marginBottom: 20,
  marginLeft: 18,
  font: "system",
  header: "{title}",
  footer: "",
};

const fontFamilies: Record<PrintSettings["font"], string> = {
  system: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  serif: '"Songti SC", "STSong", Georgia, serif',
  mono: '"SFMono-Regular", Menlo, monospace',
};

function safeMargin(value: number): number {
  return Math.min(50, Math.max(5, Number.isFinite(value) ? value : 18));
}

function cssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll(/\r?\n/g, " ");
}

export function buildPrintCss(settings: PrintSettings, title: string): string {
  const header = cssString(settings.header.replaceAll("{title}", title));
  const footer = cssString(settings.footer.replaceAll("{title}", title));
  const footerPrefix = footer ? `"${footer}  ·  " ` : "";
  return `
@page {
  size: ${settings.paper};
  margin: ${safeMargin(settings.marginTop)}mm ${safeMargin(settings.marginRight)}mm ${safeMargin(settings.marginBottom)}mm ${safeMargin(settings.marginLeft)}mm;
  @top-center { content: "${header}"; color: #777; font-size: 9pt; }
  @bottom-center { content: ${footerPrefix}counter(page) " / " counter(pages); color: #777; font-size: 9pt; }
}
body { color: #262925; font-family: ${fontFamilies[settings.font]}; line-height: 1.72; }
h1, h2, h3 { break-after: avoid; }
pre, blockquote, figure { break-inside: avoid; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.yuling-page-break { display: block; height: 1px; margin: 0; break-after: page; page-break-after: always; }
th, td { border: 1px solid #d9d8d2; padding: 7px 9px; min-width: 80px; word-break: normal; overflow-wrap: break-word; }
img { max-width: 100%; max-height: 245mm; object-fit: contain; }
code { font-family: "SFMono-Regular", Menlo, monospace; }
`;
}
