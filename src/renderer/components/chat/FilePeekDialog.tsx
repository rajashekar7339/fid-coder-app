import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, FileText, Loader2, X } from "lucide-react";
import type { Citation } from "../../../shared/citations";
import type { WorkspaceFilePeek } from "../../../shared/types";
import { highlightLines, languageForPath } from "../../lib/code-highlight";
import { errorText, fid } from "../../lib/fid";
import { Modal } from "../ui/Modal";

export type FilePeekRequest = {
  path: string;
  line: number;
  endLine: number | null;
  related: Citation[];
};

type Position = {
  line: number;
  endLine: number | null;
};

type ReaderTab = {
  key: string;
  path: string;
  positions: Position[];
  index: number;
  related: Citation[];
  view: WorkspaceFilePeek | null;
  loading: boolean;
  error: string | null;
};

type Props = {
  agentId: string;
  request: FilePeekRequest | null;
  onClose: () => void;
};

function citationKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function tabLabel(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function directoryLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const at = normalized.lastIndexOf("/");
  return at > 0 ? normalized.slice(0, at) : "workspace";
}

function referenceLabel(citation: Citation): string {
  return `${citation.path}:${citation.line}${citation.endLine === null ? "" : `-${citation.endLine}`}`;
}

export function FilePeekDialog({ agentId, request, onClose }: Props) {
  const [tabs, setTabs] = useState<ReaderTab[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tabsRef = useRef<ReaderTab[]>([]);
  const loadSequence = useRef(new Map<string, number>());
  const lastRequest = useRef<FilePeekRequest | null>(null);
  const code = useRef<HTMLPreElement>(null);
  const copyTimer = useRef<number | null>(null);

  const commit = useCallback((next: ReaderTab[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);

  const loadTab = useCallback(
    (key: string, path: string, position: Position) => {
      const sequence = (loadSequence.current.get(key) ?? 0) + 1;
      loadSequence.current.set(key, sequence);
      commit(
        tabsRef.current.map((tab) =>
          tab.key === key ? { ...tab, loading: true, error: null, view: null } : tab,
        ),
      );
      void fid()
        .workspace.file(agentId, path, position.line, position.endLine)
        .then((view) => {
          if (loadSequence.current.get(key) !== sequence) return;
          commit(
            tabsRef.current.map((tab) =>
              tab.key === key
                ? { ...tab, path: view.path, view, loading: false, error: null }
                : tab,
            ),
          );
        })
        .catch((caught: unknown) => {
          if (loadSequence.current.get(key) !== sequence) return;
          commit(
            tabsRef.current.map((tab) =>
              tab.key === key
                ? { ...tab, view: null, loading: false, error: errorText(caught) }
                : tab,
            ),
          );
        });
    },
    [agentId, commit],
  );

  const openCitation = useCallback(
    (next: FilePeekRequest) => {
      const key = citationKey(next.path);
      const position: Position = { line: next.line, endLine: next.endLine };
      const current = tabsRef.current;
      const existingIndex = current.findIndex((tab) => tab.key === key);
      if (existingIndex >= 0) {
        const existing = current[existingIndex]!;
        const currentPosition = existing.positions[existing.index];
        const same =
          currentPosition?.line === position.line && currentPosition?.endLine === position.endLine;
        const base = existing.positions.slice(0, existing.index + 1);
        const positions = same ? base : [...base, position];
        const updated: ReaderTab = {
          ...existing,
          positions,
          index: positions.length - 1,
          related: next.related,
        };
        commit(current.map((tab, index) => (index === existingIndex ? updated : tab)));
        setActiveKey(key);
        setOpen(true);
        loadTab(key, existing.path, position);
        return;
      }

      const created: ReaderTab = {
        key,
        path: next.path,
        positions: [position],
        index: 0,
        related: next.related,
        view: null,
        loading: true,
        error: null,
      };
      commit([...current, created]);
      setActiveKey(key);
      setOpen(true);
      loadTab(key, next.path, position);
    },
    [commit, loadTab],
  );

  useEffect(() => {
    if (!request || request === lastRequest.current) return;
    lastRequest.current = request;
    openCitation(request);
  }, [openCitation, request]);

  const hide = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);

  const go = useCallback(
    (delta: number) => {
      if (!activeKey) return;
      const tab = tabsRef.current.find((item) => item.key === activeKey);
      if (!tab) return;
      const index = tab.index + delta;
      const position = tab.positions[index];
      if (!position) return;
      commit(
        tabsRef.current.map((item) => (item.key === activeKey ? { ...item, index } : item)),
      );
      loadTab(activeKey, tab.path, position);
    },
    [activeKey, commit, loadTab],
  );

  const closeTab = useCallback(
    (key: string) => {
      const current = tabsRef.current;
      const index = current.findIndex((tab) => tab.key === key);
      if (index < 0) return;
      const next = current.filter((tab) => tab.key !== key);
      loadSequence.current.delete(key);
      commit(next);
      if (activeKey !== key) return;
      if (next.length === 0) {
        setActiveKey(null);
        hide();
        return;
      }
      setActiveKey(next[Math.min(index, next.length - 1)]!.key);
    },
    [activeKey, commit, hide],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, open]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const active = tabs.find((tab) => tab.key === activeKey) ?? null;
  const view = active?.view ?? null;
  const lines = useMemo(() => view?.text.split("\n") ?? [], [view]);
  const highlighted = useMemo(
    () => (view ? highlightLines(view.text, languageForPath(view.path)) : null),
    [view],
  );

  useEffect(() => {
    const element = code.current;
    if (!view || !element) return;
    const target = element.querySelector<HTMLElement>(".file-peek-line.is-target");
    if (!target) {
      element.scrollTop = 0;
      return;
    }
    element.scrollTop = Math.max(
      0,
      target.offsetTop - element.clientHeight / 2 + target.offsetHeight / 2,
    );
  }, [view]);

  useEffect(() => {
    setCopied(false);
  }, [activeKey, view?.line, view?.lineEnd, view?.path]);

  if (!open || !active) return null;

  function copyTarget() {
    if (!view) return;
    const target = view.line
      ? `${view.path}:${view.line}${view.lineEnd ? `-${view.lineEnd}` : ""}`
      : view.path;
    void navigator.clipboard.writeText(target).then(() => {
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1200);
    });
  }

  const targetEnd = view?.line == null ? null : view.lineEnd ?? view.line;
  const currentPosition = active.positions[active.index] ?? null;

  return (
    <Modal label={`Code ${active.path}`} className="file-peek-modal" onClose={hide}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Read-only code</div>
          <div className="modal-title file-peek-title" title={active.path}>
            {active.path}
          </div>
        </div>
        <div className="file-peek-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Back in file history"
            title="Back (Alt+Left)"
            disabled={active.index <= 0}
            onClick={() => go(-1)}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Forward in file history"
            title="Forward (Alt+Right)"
            disabled={active.index >= active.positions.length - 1}
            onClick={() => go(1)}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Copy path and line"
            title="Copy path and line"
            disabled={!view}
            onClick={copyTarget}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close file preview"
            onClick={hide}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {tabs.length > 1 ? (
        <div className="file-peek-tabs" role="tablist" aria-label="Open files">
          {tabs.map((tab) => {
            const label = tabLabel(tab.path);
            const isActive = tab.key === active.key;
            return (
              <div key={tab.key} className={`file-peek-tab ${isActive ? "is-active" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="file-peek-tab-label"
                  title={tab.path}
                  onClick={() => setActiveKey(tab.key)}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className="file-peek-tab-close"
                  aria-label={`Close ${label}`}
                  onClick={() => closeTab(tab.key)}
                >
                  <X size={10} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div
        className="file-peek-body"
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-label={tabs.length > 1 ? active.path : undefined}
      >
        {active.loading ? (
          <div className="file-peek-empty">
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Reading the file…
          </div>
        ) : active.error ? (
          <div className="file-peek-empty is-error" role="alert">
            <FileText size={18} aria-hidden="true" />
            <strong>Could not open this file.</strong>
            <span>{active.error}</span>
          </div>
        ) : view ? (
          <>
            <div className="file-peek-meta">
              <span>
                Lines {view.startLine}–{view.endLine} of {view.totalLines}
              </span>
              {view.line ? (
                <span className="file-peek-target">
                  {view.lineEnd ? `Lines ${view.line}–${view.lineEnd}` : `Line ${view.line}`}
                </span>
              ) : null}
              {view.truncated ? <span>Preview is truncated</span> : null}
            </div>
            <div className="file-peek-main">
              {active.related.length > 1 ? (
                <aside className="file-peek-refs" aria-label="Code references in this answer">
                  <div className="file-peek-refs-head">
                    <span>Code references</span>
                    <span className="file-peek-refs-count">{active.related.length}</span>
                  </div>
                  {active.related.map((reference) => {
                    const isCurrent =
                      citationKey(reference.path) === active.key &&
                      currentPosition?.line === reference.line &&
                      (currentPosition?.endLine ?? null) === reference.endLine;
                    return (
                      <button
                        key={`${reference.path}:${reference.line}:${reference.endLine ?? ""}`}
                        type="button"
                        className={`file-peek-ref ${isCurrent ? "is-current" : ""}`}
                        aria-label={`Open ${referenceLabel(reference)}`}
                        aria-current={isCurrent ? "true" : undefined}
                        title={referenceLabel(reference)}
                        onClick={() =>
                          openCitation({
                            path: reference.path,
                            line: reference.line,
                            endLine: reference.endLine,
                            related: active.related,
                          })
                        }
                      >
                        <span className="file-peek-ref-top">
                          <span className="file-peek-ref-name">{tabLabel(reference.path)}</span>
                          <span className="file-peek-ref-range">
                            {reference.endLine === null
                              ? reference.line
                              : `${reference.line}–${reference.endLine}`}
                          </span>
                        </span>
                        <span className="file-peek-ref-path">{directoryLabel(reference.path)}</span>
                      </button>
                    );
                  })}
                </aside>
              ) : null}
              <pre
                ref={code}
                className="file-peek-code"
                tabIndex={0}
                aria-label={`Contents of ${view.path}`}
              >
                {view.totalLines === 0 ? (
                  <span className="file-peek-empty-line">(empty file)</span>
                ) : (
                  lines.map((text, index) => {
                    const number = view.startLine + index;
                    const isTarget =
                      view.line !== null &&
                      targetEnd !== null &&
                      number >= view.line &&
                      number <= targetEnd;
                    return (
                      <span
                        key={number}
                        className={`file-peek-line ${isTarget ? "is-target" : ""}`}
                      >
                        <span className="file-peek-line-number">{number}</span>
                        {highlighted ? (
                          <span
                            className="file-peek-line-text"
                            dangerouslySetInnerHTML={{ __html: highlighted[index] || " " }}
                          />
                        ) : (
                          <span className="file-peek-line-text">{text || " "}</span>
                        )}
                      </span>
                    );
                  })
                )}
              </pre>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
