import {
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Mermaid, MermaidConfig } from "mermaid";
import { collectCitations, type Citation } from "../../../shared/citations";
import { highlightCode } from "../../lib/code-highlight";
import { renderInlineMarkdown } from "../../lib/inline-markdown";
import {
  isAsciiDiagram,
  isMermaidBlock,
  parseMessageBlocks,
  type TableAlign,
} from "../../lib/message-markdown";

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "base",
  look: "classic",
  htmlLabels: true,
  layout: "dagre",
  fontFamily: '"Geist Variable", "Segoe UI", sans-serif',
  fontSize: 11.5,
  themeCSS: `
    .node { filter: none !important; }
    .node rect { rx: 5px; ry: 5px; }
    g.nodes > g.node:nth-child(5n + 1) :is(rect, polygon, circle, ellipse) {
      fill: rgba(108, 156, 255, 0.16) !important;
      stroke: #8bb8ff !important;
    }
    g.nodes > g.node:nth-child(5n + 2) :is(rect, polygon, circle, ellipse) {
      fill: rgba(88, 214, 180, 0.14) !important;
      stroke: #7fdcc4 !important;
    }
    g.nodes > g.node:nth-child(5n + 3) :is(rect, polygon, circle, ellipse) {
      fill: rgba(178, 145, 255, 0.16) !important;
      stroke: #c0a8ff !important;
    }
    g.nodes > g.node:nth-child(5n + 4) :is(rect, polygon, circle, ellipse) {
      fill: rgba(235, 187, 99, 0.14) !important;
      stroke: #ecc77c !important;
    }
    g.nodes > g.node:nth-child(5n + 5) :is(rect, polygon, circle, ellipse) {
      fill: rgba(238, 137, 159, 0.14) !important;
      stroke: #f0a2b3 !important;
    }
    g.nodes > g.node :is(rect, polygon, circle, ellipse) {
      stroke-width: 1.25px !important;
    }
    .edgePaths path,
    .edgePath path,
    path.flowchart-link {
      stroke: #8bb8ff !important;
      stroke-width: 1.55px !important;
    }
    marker path {
      fill: #8bb8ff !important;
      stroke: #8bb8ff !important;
    }
    .cluster rect {
      fill: rgba(139, 184, 255, 0.045) !important;
      stroke: rgba(139, 184, 255, 0.34) !important;
    }
    .actor { fill: #2b2d30 !important; stroke: #5f646d !important; }
    .actor-line { stroke: #5f646d !important; }
    .messageLine0, .messageLine1 { stroke: #92959e !important; }
    .messageText { fill: #c8cbd1 !important; }
    .note { fill: #313338 !important; stroke: #5f646d !important; }
    .noteText { fill: #e3e5e8 !important; }
    .labelText, .loopText { fill: #c8cbd1 !important; }
    .activation0, .activation1, .activation2 { fill: #393b40 !important; stroke: #5f646d !important; }
  `,
  themeVariables: {
    background: "#1c1d21",
    primaryColor: "#2b2d30",
    primaryTextColor: "#e3e5e8",
    primaryBorderColor: "#5f646d",
    secondaryColor: "#313338",
    secondaryTextColor: "#e3e5e8",
    secondaryBorderColor: "#5f646d",
    tertiaryColor: "#24262a",
    tertiaryTextColor: "#c8cbd1",
    tertiaryBorderColor: "#4a4e56",
    mainBkg: "#2b2d30",
    nodeBorder: "#5f646d",
    nodeTextColor: "#e3e5e8",
    clusterBkg: "#232529",
    clusterBorder: "#4a4e56",
    lineColor: "#92959e",
    textColor: "#c8cbd1",
    titleColor: "#e3e5e8",
    edgeLabelBackground: "#1c1d21",
    arrowheadColor: "#92959e",
    actorBkg: "#2b2d30",
    actorBorder: "#5f646d",
    actorTextColor: "#e3e5e8",
    signalColor: "#92959e",
    signalTextColor: "#c8cbd1",
    noteBkgColor: "#313338",
    noteTextColor: "#e3e5e8",
    noteBorderColor: "#5f646d",
    activationBkgColor: "#313338",
    activationBorderColor: "#5f646d",
    sequenceNumberColor: "#1c1d21",
  },
  flowchart: {
    useMaxWidth: true,
    curve: "basis",
    padding: 16,
    wrappingWidth: 120,
    nodeSpacing: 18,
    rankSpacing: 30,
    diagramPadding: 8,
  },
};

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

// HTML labels cannot be rasterized from an SVG image, so the exported PNG
// is rendered again with SVG text labels.
const EXPORT_MERMAID_CONFIG: MermaidConfig = {
  ...MERMAID_CONFIG,
  htmlLabels: false,
  flowchart: {
    ...(MERMAID_CONFIG.flowchart ?? {}),
    wrappingWidth: 240,
  },
};

const EXPORT_SCALE = 2;
const MAX_EXPORT_EDGE = 8192;

let mermaidLoader: Promise<Mermaid> | null = null;
let mermaidId = 0;
let mermaidQueue: Promise<unknown> = Promise.resolve();

function queueMermaid<T>(task: () => Promise<T>): Promise<T> {
  const run = mermaidQueue.then(task, task);
  mermaidQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return mermaid;
  });
  return mermaidLoader;
}

async function renderMermaidSvg(renderId: string, code: string, config: MermaidConfig): Promise<string> {
  return queueMermaid(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize(config);
    try {
      const { svg } = await mermaid.render(renderId, code);
      return svg;
    } finally {
      mermaid.initialize(MERMAID_CONFIG);
    }
  });
}

async function svgToPngBlob(svgText: string): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = parsed.documentElement;
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const width = Number.isFinite(box[2]) && box[2] > 0 ? box[2] : 800;
  const height = Number.isFinite(box[3]) && box[3] > 0 ? box[3] : 600;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const serialized = new XMLSerializer().serializeToString(root);
  const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }));

  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not render the diagram image."));
      image.src = url;
    });

    const scale = Math.min(EXPORT_SCALE, MAX_EXPORT_EDGE / width, MAX_EXPORT_EDGE / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw the diagram image.");
    const background =
      getComputedStyle(document.documentElement).getPropertyValue("--code").trim() || "#1c1d21";
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not create the diagram image."))),
        "image/png",
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function copyDiagramImage(code: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    throw new Error("Copying images is not available in this app.");
  }
  const svg = await renderMermaidSvg(`fid-mermaid-export-${++mermaidId}`, code, EXPORT_MERMAID_CONFIG);
  const png = await svgToPngBlob(svg);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

const INLINE_CLASSES = { code: "md-code", link: "md-link" };

type OpenFile = (
  path: string,
  line: number,
  endLine: number | null,
  related: Citation[],
) => void;

function citationLabel(citation: Citation): string {
  return `${citation.path}:${citation.line}${citation.endLine === null ? "" : `-${citation.endLine}`}`;
}

function nodeCitation(node: Element): Citation | null {
  const whole = collectCitations(node.textContent ?? "");
  if (whole.length > 0) return whole[0] ?? null;
  for (const line of node.querySelectorAll("tspan")) {
    const found = collectCitations(line.textContent ?? "");
    if (found.length > 0) return found[0] ?? null;
  }
  return null;
}

function markDiagramLinks(root: HTMLElement | null, onOpenFile?: OpenFile) {
  if (!root) return;
  for (const node of root.querySelectorAll<SVGGElement>("g.node")) {
    const citation = onOpenFile ? nodeCitation(node) : null;
    if (!citation) {
      node.classList.remove("is-code-linked");
      node.removeAttribute("tabindex");
      node.removeAttribute("role");
      node.removeAttribute("aria-label");
      node.removeAttribute("data-fid-path");
      node.removeAttribute("data-fid-line");
      node.removeAttribute("data-fid-end");
      continue;
    }
    node.classList.add("is-code-linked");
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Open ${citationLabel(citation)}`);
    node.setAttribute("data-fid-path", citation.path);
    node.setAttribute("data-fid-line", String(citation.line));
    if (citation.endLine === null) node.removeAttribute("data-fid-end");
    else node.setAttribute("data-fid-end", String(citation.endLine));
  }
}

function linkedCitation(target: EventTarget | null): Citation | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest("g.node.is-code-linked");
  if (!node) return null;
  const path = node.getAttribute("data-fid-path");
  const line = Number(node.getAttribute("data-fid-line"));
  const end = node.getAttribute("data-fid-end");
  if (!path || !Number.isFinite(line)) return null;
  const endLine = end === null ? null : Number(end);
  return {
    path,
    line,
    endLine: endLine !== null && Number.isFinite(endLine) ? endLine : null,
  };
}

function renderInline(text: string, keyPrefix: string, onOpenFile?: OpenFile) {
  return renderInlineMarkdown(text, keyPrefix, INLINE_CLASSES, onOpenFile);
}

function alignClass(align: TableAlign): string {
  return align === "center" ? "is-center" : align === "right" ? "is-right" : "";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className="code-copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function CopyImageButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  function copy() {
    if (state === "copying") return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    setError(null);
    setState("copying");
    void copyDiagramImage(code)
      .then(() => setState("copied"))
      .catch((caught: unknown) => {
        console.error("Failed to copy the diagram image", caught);
        setError(caught instanceof Error ? caught.message : "Could not copy the image.");
        setState("failed");
      })
      .finally(() => {
        timer.current = window.setTimeout(() => {
          setState("idle");
          setError(null);
        }, 1800);
      });
  }

  const label =
    state === "copying" ? "Copying" : state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy image";

  return (
    <button
      type="button"
      className="code-copy"
      aria-label="Copy diagram as image"
      title={error ?? "Copy diagram as an image for Confluence"}
      disabled={state === "copying"}
      onClick={copy}
    >
      {state === "copying" ? (
        <Loader2 size={11} className="spin" aria-hidden="true" />
      ) : state === "copied" ? (
        <Check size={11} />
      ) : (
        <ImageIcon size={11} />
      )}
      {label}
    </button>
  );
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  const diagram = isAsciiDiagram(text, language);
  const highlighted = diagram ? null : highlightCode(text, language);

  return (
    <div className={`code-block ${diagram ? "is-diagram" : ""}`}>
      <div className="code-block-bar">
        <span>{diagram ? "Diagram" : language || "Code"}</span>
        <CopyButton text={text} />
      </div>
      <pre>
        {highlighted ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{text}</code>
        )}
      </pre>
    </div>
  );
}

export function MermaidDiagram({
  code,
  streaming = false,
  onOpenFile,
}: {
  code: string;
  streaming?: boolean;
  onOpenFile?: OpenFile;
}) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [scrollable, setScrollable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullZoom, setFullZoom] = useState(1);
  const canvas = useRef<HTMLDivElement>(null);
  const overlayCanvas = useRef<HTMLDivElement>(null);
  const closeExpanded = useRef<HTMLButtonElement>(null);
  const links = useMemo(() => collectCitations(code), [code]);

  useEffect(() => {
    if (streaming) return;
    let active = true;
    const renderId = `fid-mermaid-${++mermaidId}`;
    setSvg("");
    setError(null);
    setShowSource(false);
    setZoom(1);
    setScrollable(false);
    setExpanded(false);
    void renderMermaidSvg(renderId, code, MERMAID_CONFIG)
      .then((rendered) => {
        if (active) setSvg(rendered);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not render this diagram.");
      });
    return () => {
      active = false;
    };
  }, [code, streaming]);

  useEffect(() => {
    if (!expanded) return;
    setFullZoom(1);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey, true);
    const frame = requestAnimationFrame(() => closeExpanded.current?.focus());
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame);
    };
  }, [expanded]);

  useEffect(() => {
    const element = canvas.current;
    if (!svg || showSource || error || !element) {
      setScrollable(false);
      return;
    }
    const sync = () => setScrollable(element.scrollWidth > element.clientWidth + 2);
    const frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    window.addEventListener("resize", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [error, showSource, svg, zoom]);

  function changeZoom(delta: number) {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));
  }

  function changeFullZoom(delta: number) {
    setFullZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta)));
  }

  function scrollDiagram(direction: -1 | 1) {
    const element = canvas.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(180, Math.round(element.clientWidth * 0.7)),
      behavior: "smooth",
    });
  }

  function openLinkedNode(target: EventTarget | null) {
    const citation = linkedCitation(target);
    if (!citation || !onOpenFile) return;
    // The full-screen diagram sits above normal modals; close it before the reader opens.
    setExpanded(false);
    onOpenFile(citation.path, citation.line, citation.endLine, links);
  }

  useEffect(() => {
    markDiagramLinks(canvas.current, onOpenFile);
    markDiagramLinks(overlayCanvas.current, onOpenFile);
  }, [expanded, onOpenFile, svg]);

  if (streaming) return <CodeBlock text={code} language="mermaid" />;

  return (
    <>
      <div className="code-block is-diagram is-mermaid">
        <div className="code-block-bar">
          <span>Diagram</span>
          <div className="code-bar-actions">
            {svg && !showSource && !error ? (
              <div className="mermaid-zoom" role="group" aria-label="Diagram zoom">
                <button
                  type="button"
                  className="code-copy mermaid-tool-button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  disabled={zoom <= MIN_ZOOM}
                  onClick={() => changeZoom(-ZOOM_STEP)}
                >
                  <Minus size={11} />
                </button>
                <button
                  type="button"
                  className="code-copy mermaid-zoom-value"
                  aria-label="Fit diagram to width"
                  title="Fit diagram to width"
                  onClick={() => setZoom(1)}
                >
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className="code-copy mermaid-tool-button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  disabled={zoom >= MAX_ZOOM}
                  onClick={() => changeZoom(ZOOM_STEP)}
                >
                  <Plus size={11} />
                </button>
              </div>
            ) : null}
            {scrollable ? (
              <div className="mermaid-scroll-controls" role="group" aria-label="Scroll diagram">
                <button
                  type="button"
                  className="code-copy mermaid-tool-button"
                  aria-label="Scroll diagram left"
                  title="Scroll left"
                  onClick={() => scrollDiagram(-1)}
                >
                  <ChevronLeft size={12} />
                </button>
                <button
                  type="button"
                  className="code-copy mermaid-tool-button"
                  aria-label="Scroll diagram right"
                  title="Scroll right"
                  onClick={() => scrollDiagram(1)}
                >
                  <ChevronRight size={12} />
                </button>
              </div>
            ) : null}
            {error ? null : (
              <button
                type="button"
                className="code-copy"
                aria-pressed={showSource}
                onClick={() => setShowSource((current) => !current)}
              >
                <Code2 size={11} />
                {showSource ? "Diagram" : "Source"}
              </button>
            )}
            {svg && !showSource && !error ? (
              <button
                type="button"
                className="code-copy"
                aria-label="Expand diagram"
                title="Open the diagram full screen"
                onClick={() => setExpanded(true)}
              >
                <Maximize2 size={11} />
                Expand
              </button>
            ) : null}
            {svg && !showSource && !error ? <CopyImageButton code={code} /> : null}
            <CopyButton text={code} />
          </div>
        </div>
        {error ? (
          <>
            <div className="mermaid-error" title={error}>
              Could not render this diagram. Showing its source instead.
            </div>
            <pre>
              <code>{code}</code>
            </pre>
          </>
        ) : showSource ? (
          <pre>
            <code>{code}</code>
          </pre>
        ) : svg ? (
          <div
            ref={canvas}
            className="mermaid-canvas"
            onClick={(event) => openLinkedNode(event.target)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              if (!linkedCitation(event.target) || !onOpenFile) return;
              event.preventDefault();
              openLinkedNode(event.target);
            }}
          >
            <div
              className="mermaid-diagram"
              style={{ width: `${zoom * 100}%` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        ) : (
          <div className="mermaid-loading">
            <Loader2 size={13} className="spin" aria-hidden="true" />
            Rendering diagram…
          </div>
        )}
        {svg && !showSource && !error && onOpenFile && links.length > 0 ? (
          <div className="mermaid-links" aria-label="Code links in this diagram">
            <span className="mermaid-links-label">Linked code</span>
            {links.map((citation) => (
              <button
                key={citationLabel(citation)}
                type="button"
                className="md-citation md-citation-code"
                title={`Open ${citationLabel(citation)}`}
                onClick={() =>
                  onOpenFile(citation.path, citation.line, citation.endLine, links)
                }
              >
                {citationLabel(citation)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {expanded
        ? createPortal(
            <div className="mermaid-overlay" role="dialog" aria-modal="true" aria-label="Full-screen diagram">
              <div className="mermaid-overlay-bar">
                <span>Diagram</span>
                <div className="mermaid-overlay-actions">
                  <div className="mermaid-zoom" role="group" aria-label="Full-screen diagram zoom">
                    <button
                      type="button"
                      className="code-copy mermaid-tool-button"
                      aria-label="Zoom out"
                      title="Zoom out"
                      disabled={fullZoom <= MIN_ZOOM}
                      onClick={() => changeFullZoom(-ZOOM_STEP)}
                    >
                      <Minus size={11} />
                    </button>
                    <button
                      type="button"
                      className="code-copy mermaid-zoom-value"
                      aria-label="Fit diagram to width"
                      title="Fit diagram to width"
                      onClick={() => setFullZoom(1)}
                    >
                      {Math.round(fullZoom * 100)}%
                    </button>
                    <button
                      type="button"
                      className="code-copy mermaid-tool-button"
                      aria-label="Zoom in"
                      title="Zoom in"
                      disabled={fullZoom >= MAX_ZOOM}
                      onClick={() => changeFullZoom(ZOOM_STEP)}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                  <CopyImageButton code={code} />
                  <button
                    ref={closeExpanded}
                    type="button"
                    className="code-copy"
                    aria-label="Close full-screen diagram"
                    onClick={() => setExpanded(false)}
                  >
                    <X size={12} />
                    Close
                  </button>
                </div>
              </div>
              <div
                ref={overlayCanvas}
                className="mermaid-overlay-canvas"
                onClick={(event) => openLinkedNode(event.target)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  if (!linkedCitation(event.target) || !onOpenFile) return;
                  event.preventDefault();
                  openLinkedNode(event.target);
                }}
              >
                <div
                  className="mermaid-diagram"
                  style={{ width: `${fullZoom * 100}%` }}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function DataTable({
  headers,
  align,
  rows,
  blockKey,
  onOpenFile,
}: {
  headers: string[];
  align: TableAlign[];
  rows: string[][];
  blockKey: string;
  onOpenFile?: OpenFile;
}) {
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((header, column) => (
              <th key={`${blockKey}-h-${column}`} scope="col" className={alignClass(align[column] ?? "left")}>
                {renderInline(header, `${blockKey}-h-${column}`, onOpenFile)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${blockKey}-r-${rowIndex}`}>
              {headers.map((_, column) => (
                <td key={`${blockKey}-r-${rowIndex}-${column}`} className={alignClass(align[column] ?? "left")}>
                  {renderInline(row[column] ?? "", `${blockKey}-r-${rowIndex}-${column}`, onOpenFile)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const MessageContent = memo(function MessageContent({
  text,
  streaming = false,
  onOpenFile,
}: {
  text: string;
  streaming?: boolean;
  onOpenFile?: OpenFile;
}) {
  const blocks = parseMessageBlocks(text);
  const related = useMemo(() => collectCitations(text), [text]);
  const openFile = useMemo<OpenFile | undefined>(
    () =>
      onOpenFile
        ? (path, line, endLine) => onOpenFile(path, line, endLine, related)
        : undefined,
    [onOpenFile, related],
  );
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") {
          return isMermaidBlock(block.language, block.text) ? (
            <MermaidDiagram
              key={key}
              code={block.text}
              streaming={streaming}
              onOpenFile={openFile}
            />
          ) : (
            <CodeBlock key={key} text={block.text} language={block.language} />
          );
        }
        if (block.type === "table") {
          return (
            <DataTable
              key={key}
              headers={block.headers}
              align={block.align}
              rows={block.rows}
              blockKey={key}
              onOpenFile={openFile}
            />
          );
        }
        if (block.type === "heading") {
          return (
            <p key={key} className={`md-heading md-h${block.level}`}>
              {renderInline(block.text, key, openFile)}
            </p>
          );
        }
        if (block.type === "list") {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`, openFile)}</li>
          ));
          if (block.ordered) {
            return (
              <ol key={key} start={block.start} className="md-list is-ordered">
                {items}
              </ol>
            );
          }
          return (
            <ul key={key} className="md-list">
              {items}
            </ul>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote key={key} className="md-quote">
              {renderInline(block.text, key, openFile)}
            </blockquote>
          );
        }
        return (
          <p key={key} className="md-paragraph">
            {renderInline(block.text, key, openFile)}
          </p>
        );
      })}
    </div>
  );
});
