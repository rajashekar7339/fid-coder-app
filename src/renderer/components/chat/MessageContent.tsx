import { Check, ChevronLeft, ChevronRight, Code2, Copy, Loader2, Minus, Plus } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { Mermaid, MermaidConfig } from "mermaid";
import { highlightCode } from "../../lib/code-highlight";
import { renderInlineMarkdown } from "../../lib/inline-markdown";
import { isAsciiDiagram, parseMessageBlocks, type TableAlign } from "../../lib/message-markdown";

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
    .edgePath .path { stroke-width: 1.5px; }
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

let mermaidLoader: Promise<Mermaid> | null = null;
let mermaidId = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return mermaid;
  });
  return mermaidLoader;
}

function isMermaidBlock(language: string, text: string): boolean {
  if (/^(mermaid|mmd)$/i.test(language.trim())) return true;
  if (language.trim()) return false;
  return /^\s*(flowchart|graph)\s+(TB|TD|BT|RL|LR)\b/i.test(text);
}

const INLINE_CLASSES = { code: "md-code", link: "md-link" };

function renderInline(text: string, keyPrefix: string) {
  return renderInlineMarkdown(text, keyPrefix, INLINE_CLASSES);
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

function MermaidBlock({ code, streaming }: { code: string; streaming: boolean }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [scrollable, setScrollable] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (streaming) return;
    let active = true;
    const renderId = `fid-mermaid-${++mermaidId}`;
    setSvg("");
    setError(null);
    setShowSource(false);
    setZoom(1);
    setScrollable(false);
    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, code))
      .then(({ svg: rendered }) => {
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

  function scrollDiagram(direction: -1 | 1) {
    const element = canvas.current;
    if (!element) return;
    element.scrollBy({
      left: direction * Math.max(180, Math.round(element.clientWidth * 0.7)),
      behavior: "smooth",
    });
  }

  if (streaming) return <CodeBlock text={code} language="mermaid" />;

  return (
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
        <div ref={canvas} className="mermaid-canvas">
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
    </div>
  );
}

function DataTable({
  headers,
  align,
  rows,
  blockKey,
}: {
  headers: string[];
  align: TableAlign[];
  rows: string[][];
  blockKey: string;
}) {
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((header, column) => (
              <th key={`${blockKey}-h-${column}`} scope="col" className={alignClass(align[column] ?? "left")}>
                {renderInline(header, `${blockKey}-h-${column}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${blockKey}-r-${rowIndex}`}>
              {headers.map((_, column) => (
                <td key={`${blockKey}-r-${rowIndex}-${column}`} className={alignClass(align[column] ?? "left")}>
                  {renderInline(row[column] ?? "", `${blockKey}-r-${rowIndex}-${column}`)}
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
}: {
  text: string;
  streaming?: boolean;
}) {
  const blocks = parseMessageBlocks(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "code") {
          return isMermaidBlock(block.language, block.text) ? (
            <MermaidBlock key={key} code={block.text} streaming={streaming} />
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
            />
          );
        }
        if (block.type === "heading") {
          return (
            <p key={key} className={`md-heading md-h${block.level}`}>
              {renderInline(block.text, key)}
            </p>
          );
        }
        if (block.type === "list") {
          const items = block.items.map((item, itemIndex) => (
            <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>
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
              {renderInline(block.text, key)}
            </blockquote>
          );
        }
        return (
          <p key={key} className="md-paragraph">
            {renderInline(block.text, key)}
          </p>
        );
      })}
    </div>
  );
});
