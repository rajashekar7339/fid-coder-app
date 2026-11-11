import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import {
  buildChangeTree,
  filterChangeTree,
  type ChangeTreeNode,
} from "../../../shared/change-tree";
import { changeTotals, findChangedFile } from "../../../shared/changes";
import type { Citation } from "../../../shared/citations";
import type {
  Agent,
  ChangeSet,
  ChangesOpenRequest,
  FileChangeSummary,
  FileDiff,
  WorkspaceFilePeek,
} from "../../../shared/types";
import { highlightLines, languageForPath } from "../../lib/code-highlight";
import { errorText, fid } from "../../lib/fid";
import { formatRelativeTime } from "../../lib/format";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DiffView } from "./DiffView";

type CitationView = {
  path: string;
  line: number;
  endLine: number | null;
};

type SideTab = "files" | "references";

type Props = {
  agent: Agent;
  changeSets: ChangeSet[];
  loading: boolean;
  error: string | null;
  request: ChangesOpenRequest | null;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
};

type Confirm = "turn" | "file";

function citationKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function directoryName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const at = normalized.lastIndexOf("/");
  return at > 0 ? normalized.slice(0, at) : "workspace";
}

function rangeLabel(line: number, endLine: number | null): string {
  return endLine === null || endLine === line ? String(line) : `${line}–${endLine}`;
}

function referenceLabel(reference: Citation): string {
  return `${reference.path}:${reference.line}${
    reference.endLine === null || reference.endLine === reference.line
      ? ""
      : `-${reference.endLine}`
  }`;
}

export function ChangesPanel({
  agent,
  changeSets,
  loading,
  error,
  request,
  onClose,
  onRefresh,
}: Props) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(
    () => request?.turnId ?? changeSets[0]?.turnId ?? null,
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    () => request?.fileId ?? changeSets[0]?.files[0]?.id ?? null,
  );
  const [filter, setFilter] = useState("");
  const [turnMenu, setTurnMenu] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [citation, setCitation] = useState<CitationView | null>(null);
  const [view, setView] = useState<"diff" | "code">("diff");
  const [sideTab, setSideTab] = useState<SideTab>(() =>
    request?.related && request.related.length > 1 ? "references" : "files",
  );
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const appliedRequest = useRef<ChangesOpenRequest | null>(null);
  useEffect(() => {
    if (request && appliedRequest.current !== request) {
      if (request.path) {
        const next: CitationView = {
          path: request.path,
          line: request.line ?? 1,
          endLine: request.endLine ?? null,
        };
        const match = findChangedFile(changeSets, request.path);
        if (!match && changeSets.length === 0 && loading) return;
        appliedRequest.current = request;
        setCitation(next);
        setSideTab(request.related && request.related.length > 1 ? "references" : "files");
        if (match) {
          setSelectedTurnId(match.turnId);
          setSelectedFileId(match.file.id);
          setView("diff");
        } else {
          setSelectedFileId(null);
          setSelectedTurnId((current) =>
            current && changeSets.some((change) => change.turnId === current)
              ? current
              : (changeSets[0]?.turnId ?? null),
          );
          setView("code");
        }
        return;
      }

      const turn = changeSets.find((change) => change.turnId === request.turnId) ?? changeSets[0] ?? null;
      if (!turn && changeSets.length === 0) return;
      appliedRequest.current = request;
      setCitation(null);
      setView("diff");
      setSideTab("files");
      if (turn) {
        const fileId =
          request.fileId && turn.files.some((file) => file.id === request.fileId)
            ? request.fileId
            : (turn.files[0]?.id ?? null);
        setSelectedTurnId(turn.turnId);
        setSelectedFileId(fileId);
      }
      return;
    }

    if (view === "code" && citation) {
      const match = findChangedFile(changeSets, citation.path);
      if (match) {
        setSelectedTurnId(match.turnId);
        setSelectedFileId(match.file.id);
        setView("diff");
      }
      return;
    }

    const turn = changeSets.find((change) => change.turnId === selectedTurnId) ?? changeSets[0] ?? null;
    if (!turn) {
      setSelectedTurnId(null);
      setSelectedFileId(null);
      return;
    }
    setSelectedTurnId(turn.turnId);
    setSelectedFileId((current) =>
      current && turn.files.some((file) => file.id === current)
        ? current
        : (turn.files[0]?.id ?? null),
    );
  }, [changeSets, citation, loading, request, selectedTurnId, view]);

  const selectedTurn = changeSets.find((change) => change.turnId === selectedTurnId) ?? changeSets[0] ?? null;

  const selectedFile =
    selectedTurn?.files.find((file) => file.id === selectedFileId) ??
    selectedTurn?.files[0] ??
    null;
  const totals = changeTotals(selectedTurn);
  const tree = useMemo(() => buildChangeTree(selectedTurn?.files ?? []), [selectedTurn]);
  const filtered = useMemo(() => filterChangeTree(tree, filter), [filter, tree]);
  const related = request?.related ?? [];
  const codeMode = view === "code" && citation !== null;
  const turnLabel =
    selectedTurn && selectedTurn.turnId === changeSets[0]?.turnId
      ? "Last turn"
      : selectedTurn
        ? formatRelativeTime(selectedTurn.startedAt)
        : "No turn";

  useEffect(() => {
    if (view !== "diff" || !selectedFile) {
      setDiff(null);
      setDiffError(null);
      setDiffLoading(false);
      return;
    }
    let cancelled = false;
    setDiff(null);
    setDiffError(null);
    setDiffLoading(true);
    void fid()
      .changes.diff(selectedFile.id)
      .then((next) => {
        if (!cancelled) setDiff(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setDiffError(errorText(caught));
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile?.id, view]);

  useEffect(() => {
    if (!turnMenu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest(".changes-turn-menu, .changes-turn-button")) {
        setTurnMenu(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [turnMenu]);

  const citedStart =
    view === "diff" &&
    citation &&
    selectedFile &&
    citationKey(citation.path) === citationKey(selectedFile.path)
      ? citation.line
      : null;
  const citedEnd = citedStart === null ? null : (citation?.endLine ?? citedStart);

  function selectFile(file: FileChangeSummary) {
    setCitation(null);
    setView("diff");
    setSideTab("files");
    setSelectedFileId(file.id);
  }

  function selectTurn(turnId: string) {
    const change = changeSets.find((candidate) => candidate.turnId === turnId);
    setSelectedTurnId(turnId);
    setSelectedFileId(change?.files[0]?.id ?? null);
    setFilter("");
    setTurnMenu(false);
    setCitation(null);
    setView("diff");
    setSideTab("files");
  }

  function selectReference(reference: Citation) {
    const next: CitationView = {
      path: reference.path,
      line: reference.line,
      endLine: reference.endLine,
    };
    setCitation(next);
    setSideTab("references");
    const match = findChangedFile(changeSets, reference.path);
    if (match) {
      setSelectedTurnId(match.turnId);
      setSelectedFileId(match.file.id);
      setView("diff");
    } else {
      setSelectedFileId(null);
      setView("code");
    }
  }

  async function revertTurn() {
    if (!selectedTurn) return;
    await fid().changes.revertTurn(selectedTurn.turnId);
    setConfirm(null);
    setCitation(null);
    setView("diff");
    setSideTab("files");
    setSelectedFileId(null);
    await onRefresh();
  }

  async function revertFile() {
    if (!selectedFile) return;
    await fid().changes.revert(selectedFile.id);
    setConfirm(null);
    setCitation(null);
    setView("diff");
    setSideTab("files");
    setSelectedFileId(null);
    await onRefresh();
  }

  const canRevertTurn =
    selectedTurn !== null &&
    selectedTurn.files.length > 0 &&
    selectedTurn.status !== null &&
    selectedTurn.files.every((file) => file.revertible);
  const canRevertFile = selectedFile?.revertible === true;
  const title = codeMode ? "Code" : "Changes";

  return (
    <>
      <aside
        ref={panel}
        className="changes-panel"
        aria-label={codeMode ? "Cited code" : "Workspace changes"}
        tabIndex={-1}
      >
        <header className="changes-head">
          <div className="changes-head-copy">
            <div className="changes-kicker">{agent.name}</div>
            <div className="changes-title">{title}</div>
          </div>
          <div className="changes-head-actions">
            {changeSets.length > 0 ? (
              <>
                <div className="changes-turn-wrap">
                  <button
                    type="button"
                    className="changes-turn-button"
                    aria-expanded={turnMenu}
                    onClick={() => setTurnMenu((open) => !open)}
                  >
                    {turnLabel}
                    <ChevronDown size={11} aria-hidden="true" />
                  </button>
                  {turnMenu ? (
                    <div className="changes-turn-menu">
                      {changeSets.map((change) => {
                        const sum = changeTotals(change);
                        return (
                          <button
                            key={change.turnId}
                            type="button"
                            className={`changes-turn-row ${change.turnId === selectedTurn?.turnId ? "is-active" : ""}`}
                            onClick={() => selectTurn(change.turnId)}
                          >
                            <span>{change.turnId === changeSets[0]?.turnId ? "Last turn" : formatRelativeTime(change.startedAt)}</span>
                            <span className="changes-turn-stats">
                              <span className="diff-add">+{sum.additions}</span>
                              <span className="diff-remove">−{sum.deletions}</span>
                            </span>
                            <span className="changes-turn-files">
                              {change.files.length} file{change.files.length === 1 ? "" : "s"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <span className="changes-totals">
                  <span className="diff-add">+{totals.additions}</span>
                  <span className="diff-remove">−{totals.deletions}</span>
                </span>
                <button
                  type="button"
                  className="changes-undo"
                  disabled={!canRevertTurn}
                  title={
                    selectedTurn?.status === null
                      ? "Wait for the turn to finish"
                      : selectedTurn?.files.some((file) => !file.revertible)
                        ? "Some files cannot be restored"
                        : "Restore every file in this turn"
                  }
                  onClick={() => setConfirm("turn")}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Undo
                </button>
              </>
            ) : null}
            <button type="button" className="icon-button" aria-label="Close changes" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>

        {citedStart !== null && selectedFile ? (
          <div className="changes-cite-context">
            <span>From citation</span>
            <code>
              {selectedFile.path}:{rangeLabel(citedStart, citedEnd)}
            </code>
            <span className="changes-cite-note">Cited lines are marked in the diff.</span>
          </div>
        ) : null}

        {codeMode && citation ? (
          <div className="changes-body">
            <CitationCodePane agentId={agent.id} citation={citation} />
            <SidePanel
              selectedTurn={selectedTurn}
              selectedFile={selectedFile}
              related={related}
              citation={citation}
              changeSets={changeSets}
              sideTab={sideTab}
              onSideTab={setSideTab}
              filter={filter}
              onFilter={setFilter}
              filtered={filtered}
              totals={totals}
              onSelectFile={selectFile}
              onSelectReference={selectReference}
            />
          </div>
        ) : loading && changeSets.length === 0 ? (
          <div className="changes-empty">
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Loading changes…
          </div>
        ) : error ? (
          <div className="changes-empty is-error" role="alert">
            <strong>Could not load changes.</strong>
            <span>{error}</span>
            <button type="button" className="btn btn-secondary" onClick={() => void onRefresh()}>
              Try again
            </button>
          </div>
        ) : !selectedTurn ? (
          <div className="changes-empty">
            <FileText size={20} aria-hidden="true" />
            <strong>No recorded file changes</strong>
            <span>File tools are tracked. Shell changes are not recorded.</span>
          </div>
        ) : (
          <div className="changes-body">
            <section className="changes-diff-pane" aria-label="Selected file diff">
              <header className="changes-diff-head">
                {selectedFile ? (
                  <>
                    <FileText size={13} aria-hidden="true" />
                    <span className={`change-kind is-${selectedFile.kind}`}>
                      {selectedFile.kind === "create" ? "new" : "edited"}
                    </span>
                    <span className="changes-diff-name" title={selectedFile.path}>
                      {selectedFile.path}
                    </span>
                    <span className="changes-diff-stats">
                      <span className="diff-add">+{selectedFile.additions}</span>
                      <span className="diff-remove">−{selectedFile.deletions}</span>
                    </span>
                  </>
                ) : (
                  <span className="changes-diff-name">Select a file</span>
                )}
              </header>

              <div className="changes-diff-scroll">
                {diffLoading ? (
                  <div className="changes-empty">
                    <Loader2 size={14} className="spin" aria-hidden="true" />
                    Reading the diff…
                  </div>
                ) : diffError ? (
                  <div className="changes-empty is-error" role="alert">
                    <strong>Could not load this diff.</strong>
                    <span>{diffError}</span>
                  </div>
                ) : diff ? (
                  <DiffView diff={diff} citedStart={citedStart} citedEnd={citedEnd} />
                ) : (
                  <div className="changes-empty">Select a file to see its diff.</div>
                )}
              </div>

              <footer className="changes-diff-foot">
                <span>File tools only. Shell changes are not recorded.</span>
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  disabled={!canRevertFile}
                  title={canRevertFile ? undefined : "This file cannot be restored."}
                  onClick={() => setConfirm("file")}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Revert file
                </button>
              </footer>
            </section>

            <SidePanel
              selectedTurn={selectedTurn}
              selectedFile={selectedFile}
              related={related}
              citation={citation}
              changeSets={changeSets}
              sideTab={sideTab}
              onSideTab={setSideTab}
              filter={filter}
              onFilter={setFilter}
              filtered={filtered}
              totals={totals}
              onSelectFile={selectFile}
              onSelectReference={selectReference}
            />
          </div>
        )}
      </aside>

      {confirm === "turn" ? (
        <ConfirmDialog
          title="Revert turn"
          description={
            <>
              Restore every file this turn changed. Files created in the turn are removed. Files edited
              outside the turn are left alone.
            </>
          }
          confirmLabel="Revert turn"
          busyLabel="Reverting…"
          onCancel={() => setConfirm(null)}
          onConfirm={revertTurn}
        />
      ) : null}

      {confirm === "file" && selectedFile ? (
        <ConfirmDialog
          title="Revert file"
          description={
            <>
              Restore <strong>{selectedFile.path}</strong> to the version before this turn. If the file
              changed after the turn, the revert is refused.
            </>
          }
          confirmLabel="Revert file"
          busyLabel="Reverting…"
          onCancel={() => setConfirm(null)}
          onConfirm={revertFile}
        />
      ) : null}
    </>
  );
}

function SidePanel({
  selectedTurn,
  selectedFile,
  related,
  citation,
  changeSets,
  sideTab,
  onSideTab,
  filter,
  onFilter,
  filtered,
  totals,
  onSelectFile,
  onSelectReference,
}: {
  selectedTurn: ChangeSet | null;
  selectedFile: FileChangeSummary | null;
  related: Citation[];
  citation: CitationView | null;
  changeSets: ChangeSet[];
  sideTab: SideTab;
  onSideTab: (tab: SideTab) => void;
  filter: string;
  onFilter: (value: string) => void;
  filtered: ChangeTreeNode[];
  totals: { additions: number; deletions: number };
  onSelectFile: (file: FileChangeSummary) => void;
  onSelectReference: (reference: Citation) => void;
}) {
  return (
    <aside className="changes-tree" aria-label="Changes and references">
      {related.length > 1 ? (
        <div className="changes-side-tabs" role="tablist" aria-label="Changes and references">
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === "files"}
            className={`changes-side-tab ${sideTab === "files" ? "is-active" : ""}`}
            onClick={() => onSideTab("files")}
          >
            Changed
            <span>{selectedTurn?.files.length ?? 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === "references"}
            className={`changes-side-tab ${sideTab === "references" ? "is-active" : ""}`}
            onClick={() => onSideTab("references")}
          >
            References
            <span>{related.length}</span>
          </button>
        </div>
      ) : null}
      {sideTab === "references" && related.length > 0 ? (
        <ReferenceList
          references={related}
          citation={citation}
          changeSets={changeSets}
          onSelect={onSelectReference}
        />
      ) : (
        <ChangeFileList
          selectedTurn={selectedTurn}
          selectedFile={selectedFile}
          totals={totals}
          filter={filter}
          onFilter={onFilter}
          filtered={filtered}
          onSelect={onSelectFile}
        />
      )}
    </aside>
  );
}

function ReferenceList({
  references,
  citation,
  changeSets,
  onSelect,
}: {
  references: Citation[];
  citation: CitationView | null;
  changeSets: ChangeSet[];
  onSelect: (reference: Citation) => void;
}) {
  return (
    <div className="changes-refs" aria-label="Code references in this answer">
      <div className="citation-refs-head">
        <span>Code references</span>
        <span className="citation-refs-count">{references.length}</span>
      </div>
      <div className="changes-refs-list">
        {references.map((reference) => {
          const current =
            citation !== null &&
            citationKey(citation.path) === citationKey(reference.path) &&
            citation.line === reference.line &&
            (citation.endLine ?? null) === reference.endLine;
          const changed = findChangedFile(changeSets, reference.path);
          return (
            <button
              key={`${reference.path}:${reference.line}:${reference.endLine ?? ""}`}
              type="button"
              className={`citation-ref ${current ? "is-current" : ""}`}
              aria-label={`Open ${referenceLabel(reference)}`}
              aria-current={current ? "true" : undefined}
              title={`${reference.path}:${rangeLabel(reference.line, reference.endLine)}`}
              onClick={() => onSelect(reference)}
            >
              <span className="citation-ref-top">
                <span className="citation-ref-name">{fileName(reference.path)}</span>
                <span className="citation-ref-range">
                  {rangeLabel(reference.line, reference.endLine)}
                </span>
              </span>
              <span className="citation-ref-path">
                <span className="changes-ref-dir">{directoryName(reference.path)}</span>
                {changed ? <span className="changes-ref-changed">changed</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ChangeFileList({
  selectedTurn,
  selectedFile,
  totals,
  filter,
  onFilter,
  filtered,
  onSelect,
}: {
  selectedTurn: ChangeSet | null;
  selectedFile: FileChangeSummary | null;
  totals: ReturnType<typeof changeTotals>;
  filter: string;
  onFilter: (value: string) => void;
  filtered: ChangeTreeNode[];
  onSelect: (file: FileChangeSummary) => void;
}) {
  return (
    <>
      <div className="changes-tree-search">
        <input
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Filter files…"
          aria-label="Filter changed files"
        />
      </div>
      <div className="changes-tree-head">
        <span>Changed files</span>
        <span>{selectedTurn?.files.length ?? 0}</span>
      </div>
      <div className="changes-tree-list">
        {filtered.length === 0 ? (
          <p className="changes-tree-empty">
            {filter.trim() ? "No matching files." : "No files in this turn."}
          </p>
        ) : (
          <ChangeTree
            nodes={filtered}
            depth={0}
            selectedId={selectedFile?.id ?? null}
            onSelect={onSelect}
          />
        )}
      </div>
      <footer className="changes-tree-foot">
        <span>
          {selectedTurn?.files.length ?? 0} file{selectedTurn?.files.length === 1 ? "" : "s"}
        </span>
        <span>
          <span className="diff-add">+{totals.additions}</span>{" "}
          <span className="diff-remove">−{totals.deletions}</span>
        </span>
      </footer>
    </>
  );
}

function CitationCodePane({ agentId, citation }: { agentId: string; citation: CitationView }) {
  const [view, setView] = useState<WorkspaceFilePeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const code = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setError(null);
    setLoading(true);
    void fid()
      .workspace.file(agentId, citation.path, citation.line, citation.endLine)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, citation.endLine, citation.line, citation.path]);

  const lines = useMemo(() => view?.text.split("\n") ?? [], [view]);
  const highlighted = useMemo(
    () => (view ? highlightLines(view.text, languageForPath(view.path)) : null),
    [view],
  );
  const targetEnd = view?.line == null ? null : view.lineEnd ?? view.line;
  const range = rangeLabel(citation.line, citation.endLine);
  const lineLabel =
    citation.endLine === null || citation.endLine === citation.line ? "Line" : "Lines";

  useEffect(() => {
    const element = code.current;
    if (!view || !element) return;
    const target = element.querySelector<HTMLElement>(".citation-line.is-target");
    if (!target) {
      element.scrollTop = 0;
      return;
    }
    element.scrollTop = Math.max(
      0,
      target.offsetTop - element.clientHeight / 2 + target.offsetHeight / 2,
    );
  }, [view]);

  return (
    <section className="changes-diff-pane" aria-label="Cited file">
      <header className="changes-diff-head">
        <FileText size={13} aria-hidden="true" />
        <span className="changes-code-badge">read-only</span>
        <span className="changes-diff-name" title={citation.path}>
          {citation.path}
        </span>
        <span className="changes-diff-stats">
          <span className="changes-diff-range">
            {lineLabel} {range}
          </span>
        </span>
      </header>

      <div className="changes-diff-scroll">
        {loading ? (
          <div className="changes-empty">
            <Loader2 size={14} className="spin" aria-hidden="true" />
            Reading the file…
          </div>
        ) : error ? (
          <div className="changes-empty is-error" role="alert">
            <strong>Could not open this file.</strong>
            <span>{error}</span>
          </div>
        ) : view ? (
          <pre
            ref={code}
            className="citation-code"
            tabIndex={0}
            aria-label={`Contents of ${view.path}`}
          >
            {view.totalLines === 0 ? (
              <span className="citation-empty-line">(empty file)</span>
            ) : (
              lines.map((text, index) => {
                const number = view.startLine + index;
                const isTarget =
                  view.line !== null &&
                  targetEnd !== null &&
                  number >= view.line &&
                  number <= targetEnd;
                return (
                  <span key={number} className={`citation-line ${isTarget ? "is-target" : ""}`}>
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
              })
            )}
          </pre>
        ) : null}
      </div>

      <footer className="changes-diff-foot">
        <span>No recorded change for this file. Showing the current file.</span>
      </footer>
    </section>
  );
}

function ChangeTree({
  nodes,
  depth,
  selectedId,
  onSelect,
}: {
  nodes: ChangeTreeNode[];
  depth: number;
  selectedId: string | null;
  onSelect: (file: FileChangeSummary) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <Fragment key={node.path}>
            <div className="changes-tree-folder" style={{ paddingLeft: 8 + depth * 13 }}>
              {node.children.length > 0 ? <Folder size={11} aria-hidden="true" /> : <ChevronRight size={10} aria-hidden="true" />}
              <span>{node.name}</span>
            </div>
            <ChangeTree nodes={node.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          </Fragment>
        ) : (
          <button
            key={node.path}
            type="button"
            className={`changes-tree-file ${node.file.id === selectedId ? "is-active" : ""}`}
            style={{ paddingLeft: 8 + depth * 13 }}
            title={node.path}
            aria-current={node.file.id === selectedId ? "true" : undefined}
            onClick={() => onSelect(node.file)}
          >
            <FileText size={11} aria-hidden="true" />
            <span className="changes-tree-name">{node.name}</span>
            {node.file.kind === "create" ? <span className="changes-tree-new" /> : null}
            <span className="changes-tree-stats">
              <span className="diff-add">+{node.file.additions}</span>
              <span className="diff-remove">−{node.file.deletions}</span>
            </span>
          </button>
        ),
      )}
    </>
  );
}
