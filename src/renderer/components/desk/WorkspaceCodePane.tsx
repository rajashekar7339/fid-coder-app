import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2 } from "lucide-react";
import { imageMimeForPath } from "../../../shared/image";
import { htmlPreviewDocument, previewKindForPath } from "../../../shared/preview";
import type {
  FileChangeSummary,
  WorkspaceFilePeek,
  WorkspaceImagePeek,
} from "../../../shared/types";
import { highlightLines, languageForPath } from "../../lib/code-highlight";
import { errorText, fid } from "../../lib/fid";
import { formatBytes } from "../../lib/format";
import { MessageContent } from "../chat/MessageContent";
import { rangeLabel } from "./workspace-labels";

const PAGE_SIZE = 400;
const PREVIEW_PAGE_SIZE = 2_000;
const MAX_PREVIEW_PAGES = 10;

type ViewMode = "preview" | "source";

export function WorkspaceCodePane({
  agentId,
  path,
  line,
  endLine,
  changed,
  onViewDiff,
}: {
  agentId: string;
  path: string;
  line: number | null;
  endLine: number | null;
  changed: FileChangeSummary | null;
  onViewDiff: () => void;
}) {
  const previewKind = previewKindForPath(path);
  const [mode, setMode] = useState<ViewMode>(() =>
    line === null && previewKind ? "preview" : "source",
  );
  const [pages, setPages] = useState<WorkspaceFilePeek[]>([]);
  const [image, setImage] = useState<WorkspaceImagePeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTruncated, setPreviewTruncated] = useState(false);
  const code = useRef<HTMLPreElement>(null);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const isImage = imageMimeForPath(path) !== null;
  const showPreview = previewKind !== null && mode === "preview";
  const sourceMode = previewKind === null || mode === "source";

  useEffect(() => {
    setMode(line === null && previewKind ? "preview" : "source");
  }, [line, path, previewKind]);

  useEffect(() => {
    if (!sourceMode) {
      generation.current += 1;
      setPages([]);
      setImage(null);
      setError(null);
      setMoreError(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    let cancelled = false;
    generation.current += 1;
    const current = generation.current;
    setPages([]);
    setImage(null);
    setError(null);
    setMoreError(null);
    setLoading(true);
    setLoadingMore(false);
    void (async () => {
      try {
        if (isImage) {
          const next = await fid().workspace.image(agentId, path);
          if (!cancelled && generation.current === current) setImage(next);
        } else {
          const next =
            line === null
              ? await fid().workspace.file(agentId, path, null, null, 1, PAGE_SIZE)
              : await fid().workspace.file(agentId, path, line, endLine);
          if (!cancelled && generation.current === current) setPages([next]);
        }
      } catch (caught: unknown) {
        if (!cancelled && generation.current === current) setError(errorText(caught));
      } finally {
        if (!cancelled && generation.current === current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, endLine, isImage, line, path, sourceMode]);

  useEffect(() => {
    if (!showPreview) {
      previewGeneration.current += 1;
      setPreviewText(null);
      setPreviewLoading(false);
      setPreviewError(null);
      setPreviewTruncated(false);
      return;
    }
    let cancelled = false;
    const current = previewGeneration.current + 1;
    previewGeneration.current = current;
    setPreviewText(null);
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewTruncated(false);
    void (async () => {
      try {
        let start = 1;
        let text = "";
        let truncated = false;
        for (let page = 0; page < MAX_PREVIEW_PAGES; page += 1) {
          const next = await fid().workspace.file(
            agentId,
            path,
            null,
            null,
            start,
            PREVIEW_PAGE_SIZE,
          );
          if (cancelled || previewGeneration.current !== current) return;
          text += `${text ? "\n" : ""}${next.text}`;
          if (next.endLine >= next.totalLines) break;
          if (next.endLine < start) {
            truncated = true;
            break;
          }
          start = next.endLine + 1;
          if (page === MAX_PREVIEW_PAGES - 1) truncated = true;
        }
        if (cancelled || previewGeneration.current !== current) return;
        setPreviewText(text);
        setPreviewTruncated(truncated);
      } catch (caught: unknown) {
        if (!cancelled && previewGeneration.current === current) {
          setPreviewError(errorText(caught));
        }
      } finally {
        if (!cancelled && previewGeneration.current === current) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId, path, showPreview]);

  const first = pages[0] ?? null;
  const last = pages[pages.length - 1] ?? null;
  const total = last?.totalLines ?? 0;
  const language = languageForPath(path);
  const anchorLine = line === null ? null : first?.line ?? line;
  const anchorEnd = anchorLine === null ? null : first?.lineEnd ?? anchorLine;
  const canLoadMore =
    !isImage && line === null && last !== null && last.endLine < last.totalLines;
  const previewEmpty = previewText !== null && previewText.trim().length === 0;

  useEffect(() => {
    const element = code.current;
    if (!element || pages.length !== 1) return;
    if (line === null) {
      element.scrollTop = 0;
      return;
    }
    const target = element.querySelector<HTMLElement>(".citation-line.is-target");
    if (!target) {
      element.scrollTop = 0;
      return;
    }
    element.scrollTop = Math.max(
      0,
      target.offsetTop - element.clientHeight / 2 + target.offsetHeight / 2,
    );
  }, [line, pages.length, path]);

  function loadMore() {
    if (isImage || !last || loadingMore || last.endLine >= last.totalLines) return;
    const current = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    void fid()
      .workspace.file(agentId, path, null, null, last.endLine + 1, PAGE_SIZE)
      .then((next) => {
        if (generation.current !== current) return;
        setPages((currentPages) => [...currentPages, next]);
      })
      .catch((caught: unknown) => {
        if (generation.current !== current) return;
        setMoreError(errorText(caught));
      })
      .finally(() => {
        if (generation.current === current) setLoadingMore(false);
      });
  }

  const range = isImage
    ? image
      ? `${image.mime.replace("image/", "").toUpperCase()} · ${formatBytes(image.bytes)}`
      : "Image"
    : showPreview
      ? previewKind === "markdown"
        ? "Markdown"
        : "HTML"
      : line !== null
        ? `${line === (endLine ?? line) ? "Line" : "Lines"} ${rangeLabel(line, endLine)}`
        : first && last
          ? total === 0
            ? "Empty file"
            : `Lines ${first.startLine}–${last.endLine} of ${total}`
          : "";

  return (
    <section
      className="changes-diff-pane"
      aria-label={isImage ? "Image preview" : showPreview ? "Document preview" : "Workspace file"}
    >
      <header className="changes-diff-head">
        {isImage ? (
          <ImageIcon size={13} aria-hidden="true" />
        ) : (
          <FileText size={13} aria-hidden="true" />
        )}
        <span className="changes-code-badge">{isImage ? "image" : "read-only"}</span>
        <span className="changes-diff-name" title={path}>
          {path}
        </span>
        {previewKind ? (
          <div className="changes-view-toggle" role="group" aria-label="File view">
            <button
              type="button"
              className={mode === "preview" ? "is-active" : ""}
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
            <button
              type="button"
              className={mode === "source" ? "is-active" : ""}
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              Source
            </button>
          </div>
        ) : null}
        <span className="changes-diff-stats">
          <span className="changes-diff-range">{range}</span>
        </span>
      </header>

      <div className="changes-diff-scroll">
        {showPreview ? (
          previewLoading ? (
            <div className="changes-empty">
              <Loader2 size={14} className="spin" aria-hidden="true" />
              Rendering the document…
            </div>
          ) : previewError ? (
            <div className="changes-empty is-error" role="alert">
              <strong>Could not open this file.</strong>
              <span>{previewError}</span>
            </div>
          ) : previewText !== null ? (
            previewKind === "markdown" ? (
              <div className="changes-markdown-preview">
                {previewEmpty ? (
                  <p className="changes-tree-empty">Empty document.</p>
                ) : (
                  <MessageContent text={previewText} />
                )}
                {previewTruncated ? (
                  <p className="changes-preview-note">
                    Preview truncated. Switch to Source for the rest.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="changes-html-preview">
                {previewEmpty ? (
                  <p className="changes-tree-empty">Empty document.</p>
                ) : (
                  <iframe
                    title={`Preview of ${path}`}
                    sandbox=""
                    srcDoc={htmlPreviewDocument(previewText)}
                  />
                )}
                {previewTruncated ? (
                  <p className="changes-preview-note">
                    Preview truncated. Switch to Source for the rest.
                  </p>
                ) : null}
              </div>
            )
          ) : (
            <div className="changes-empty">No content.</div>
          )
        ) : loading ? (
          <div className="changes-empty">
            <Loader2 size={14} className="spin" aria-hidden="true" />
            {isImage ? "Reading the image…" : "Reading the file…"}
          </div>
        ) : error ? (
          <div className="changes-empty is-error" role="alert">
            <strong>Could not open this file.</strong>
            <span>{error}</span>
          </div>
        ) : image ? (
          <div className="changes-image-preview">
            <img
              src={image.dataUrl}
              alt={`Preview of ${image.path}`}
              onError={() => setError("That image could not be decoded.")}
            />
          </div>
        ) : pages.length > 0 ? (
          <pre ref={code} className="citation-code" tabIndex={0} aria-label={`Contents of ${path}`}>
            {total === 0 ? (
              <span className="citation-empty-line">(empty file)</span>
            ) : (
              pages.map((page, pageIndex) => {
                const lines = page.text.split("\n");
                const highlighted = highlightLines(page.text, language);
                return lines.map((text, index) => {
                  const number = page.startLine + index;
                  const isTarget =
                    anchorLine !== null &&
                    anchorEnd !== null &&
                    number >= anchorLine &&
                    number <= anchorEnd;
                  return (
                    <span
                      key={`${pageIndex}:${number}`}
                      className={`citation-line ${isTarget ? "is-target" : ""}`}
                    >
                      <span className="citation-line-number">{number}</span>
                      {highlighted ? (
                        <span
                          className="citation-line-text"
                          dangerouslySetInnerHTML={{ __html: highlighted[index] || " " }}
                        />
                      ) : (
                        <span className="citation-line-text">{text || " "}</span>
                      )}
                    </span>
                  );
                });
              })
            )}
          </pre>
        ) : (
          <div className="changes-empty">No content.</div>
        )}
      </div>

      <footer className="changes-diff-foot">
        <span>
          {isImage
            ? "Image preview. Read-only."
            : showPreview
              ? previewKind === "markdown"
                ? "Markdown preview. Read-only."
                : "HTML preview. Scripts and external assets are disabled."
              : changed
                ? "Read-only. This file has a recorded change."
                : "No recorded change for this file. Showing the current file."}
        </span>
        {moreError ? (
          <span className="changes-code-more-error" role="alert" title={moreError}>
            {moreError}
          </span>
        ) : null}
        <div className="changes-code-actions">
          {canLoadMore ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          ) : null}
          {changed && !isImage ? (
            <button type="button" className="btn btn-secondary" onClick={onViewDiff}>
              View diff
            </button>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
