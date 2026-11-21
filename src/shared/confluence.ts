export type ConfluenceMode = "cloud" | "data-center";

export type ConfluenceConfig = {
  siteUrl: string;
  email: string;
  mode: ConfluenceMode;
};

export function isConfluenceMode(value: unknown): value is ConfluenceMode {
  return value === "cloud" || value === "data-center";
}

/**
 * The REST base for a Confluence site. A Cloud site always uses /wiki; a
 * Data Center site keeps the path it was given, such as /confluence.
 */
export function confluenceBaseUrl(siteUrl: string, mode: ConfluenceMode): string {
  let parsed: URL;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error("Save a Confluence site URL such as https://confluence.example.com.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The Confluence site must start with http:// or https://.");
  }
  if (mode === "cloud") return `${parsed.origin}/wiki`;
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function normalizeConfluenceSite(raw: string, mode: ConfluenceMode): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const base = confluenceBaseUrl(trimmed, mode);
  // Store the Cloud site, not the /wiki REST base; the tools add /wiki.
  return mode === "cloud" ? new URL(base).origin : base;
}

export type ConfluenceLinkTarget = {
  /** The normalized link. */
  url: string;
  id: string | null;
  spaceKey: string | null;
  title: string | null;
  /** True for a short or unknown link that needs a redirect to reach an id. */
  unresolved: boolean;
};

function decodePathPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

/**
 * Turn a pasted Confluence page link into the fields the REST API needs.
 * Cloud page links carry a numeric id; Data Center display links carry a
 * space key and title. Short links such as /x/abc are marked unresolved so
 * the caller can follow the redirect. Links outside the saved site are
 * refused before any request sends the token.
 */
export function confluenceLinkTarget(base: string, rawLink: string): ConfluenceLinkTarget {
  let target: URL;
  try {
    target = new URL(String(rawLink ?? "").trim());
  } catch {
    throw new Error("Paste a full Confluence page URL.");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Only http and https Confluence links are allowed.");
  }
  if (target.username || target.password) {
    throw new Error("Remove the credentials from the Confluence link and save the token in Settings.");
  }
  const baseUrl = new URL(base);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  const targetPath = target.pathname.replace(/\/+$/, "");
  if (
    target.origin !== baseUrl.origin ||
    (basePath && targetPath !== basePath && !targetPath.startsWith(`${basePath}/`))
  ) {
    throw new Error("That link is not on the configured Confluence site.");
  }

  const unresolved: ConfluenceLinkTarget = {
    url: target.toString(),
    id: null,
    spaceKey: null,
    title: null,
    unresolved: true,
  };
  const pageId = target.searchParams.get("pageId");
  if (pageId && /^[A-Za-z0-9_-]+$/.test(pageId)) {
    return { ...unresolved, id: pageId, unresolved: false };
  }
  const inner = basePath ? targetPath.slice(basePath.length) : targetPath;
  const parts = inner
    .split("/")
    .filter(Boolean)
    .map(decodePathPart);
  if (
    parts[0] === "spaces" &&
    parts[1] &&
    parts[2] === "pages" &&
    parts[3] &&
    /^[A-Za-z0-9_-]+$/.test(parts[3])
  ) {
    return { ...unresolved, id: parts[3], spaceKey: parts[1], unresolved: false };
  }
  if (parts[0] === "pages" && parts[1] && /^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return { ...unresolved, id: parts[1], unresolved: false };
  }
  if (parts[0] === "display" && parts[1] && parts[2]) {
    return { ...unresolved, spaceKey: parts[1], title: parts[2], unresolved: false };
  }
  return unresolved;
}

export function confluencePageUrl(
  base: string,
  links: { webui?: unknown } | null | undefined,
): string | null {
  const webui = links && typeof links.webui === "string" ? links.webui : "";
  if (!webui) return null;
  if (/^https?:\/\//i.test(webui)) return webui;
  const cleanBase = base.replace(/\/+$/, "");
  let pagePath = webui.replace(/^\/+/, "");
  try {
    // Some proxies return the context path in webui as well; do not add it twice.
    const basePath = new URL(cleanBase).pathname.replace(/^\//, "").replace(/\/+$/, "");
    const prefix = basePath.toLowerCase();
    if (prefix && pagePath.toLowerCase() === prefix) return cleanBase;
    if (prefix && pagePath.toLowerCase().startsWith(`${prefix}/`)) {
      pagePath = pagePath.slice(basePath.length + 1);
    }
  } catch {
    // Keep the joined form when the base is not a full URL.
  }
  return `${cleanBase}/${pagePath}`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Plain text from Confluence's rendered HTML or storage XHTML. */
export function confluenceText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) {
        const code = Number.parseInt(name.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (name.startsWith("#")) {
        const code = Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function storageHasMacros(storage: string): boolean {
  return /<ac:/i.test(storage);
}

export function confluenceToolsReady(
  siteUrl: string | null | undefined,
  email: string | null | undefined,
  mode: string | null | undefined,
  token: unknown,
): boolean {
  return Boolean(
    siteUrl &&
      token &&
      isConfluenceMode(mode) &&
      (mode !== "cloud" || email),
  );
}
