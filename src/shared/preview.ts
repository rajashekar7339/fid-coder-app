export type FilePreviewKind = "markdown" | "html";

export function previewKindForPath(path: string): FilePreviewKind | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "html" || extension === "htm") return "html";
  return null;
}

const PREVIEW_HEAD =
  `<meta charset="utf-8">` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:;">`;

export function htmlPreviewDocument(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${PREVIEW_HEAD}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}<head>${PREVIEW_HEAD}</head>`);
  }
  return `<!doctype html><html><head>${PREVIEW_HEAD}</head><body>${html}</body></html>`;
}
