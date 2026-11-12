import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  Folder,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  X,
} from "lucide-react";
import { ancestorDirectories, normalizeWorkspacePath } from "../../../shared/file-tree";
import { imageMimeForPath } from "../../../shared/image";
import { changeTotals, findChangedFile } from "../../../shared/changes";
import type { Citation } from "../../../shared/citations";
import type {
  Agent,
  ChangeSet,
  ChangesOpenRequest,
  FileChangeSummary,
  FileDiff,
  WorkspaceDirectory,
} from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatRelativeTime } from "../../lib/format";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DiffView } from "./DiffView";
import { WorkspaceCodePane } from "./WorkspaceCodePane";
import { WorkspaceNavigator } from "./WorkspaceNavigator";
import { rangeLabel, type CitationView } from "./workspace-labels";

type Props = {
  agent: Agent;
  changeSets: ChangeSet[];
  loading: boolean;
  error: string | null;
  request: ChangesOpenRequest | null;
  chatCollapsed: boolean;
  onToggleChat: () => void;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
};

type Confirm = "turn" | "file";

export function ChangesPanel({
  agent,
  changeSets,
  loading,
  error,
  request,
  chatCollapsed,
  onToggleChat,
  onClose,
  onRefresh,
}: Props) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(
    () => request?.turnId ?? changeSets[0]?.turnId ?? null,
  );
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    () => request?.fileId ?? changeSets[0]?.files[0]?.id ?? null,
  );
  const [citation, setCitation] = useState<CitationView | null>(null);
  const [codePath, setCodePath] = useState<string | null>(request?.path ?? null);
  const [view, setView] = useState<"diff" | "code">("diff");
  const [filter, setFilter] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [directories, setDirectories] = useState<Record<string, WorkspaceDirectory>>({});
  const [dirLoading, setDirLoading] = useState<Record<string, boolean>>({});
  const [dirErrors, setDirErrors] = useState<Record<string, string>>({});
  const [refsOpen, setRefsOpen] = useState(true);
  const [changedOpen, setChangedOpen] = useState(true);
  const [turnMenu, setTurnMenu] = useState(false);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const panel = useRef<HTMLElement>(null);
  const filterInput = useRef<HTMLInputElement>(null);
  const loadedDirs = useRef(new Set<string>());
  const loadingDirs = useRef(new Set<string>());
  const treeGeneration = useRef(0);
  const lastChangeSets = useRef<ChangeSet[] | null>(null);
  const appliedRequest = useRef<ChangesOpenRequest | null>(null);

  useEffect(() => {
    panel.current?.focus();
  }, []);

  const loadDir = useCallback(
    async (path: string): Promise<void> => {
      if (loadedDirs.current.has(path) || loadingDirs.current.has(path)) return;
      if (!agent.workspaceDir) {
        setDirErrors((current) => ({
          ...current,
          [path]: "Pick a workspace folder for this agent first",
        }));
        return;
      }
      const generation = treeGeneration.current;
      loadingDirs.current.add(path);
      setDirLoading((current) => ({ ...current, [path]: true }));
      try {
        const listing = await fid().workspace.list(agent.id, path);
        if (generation !== treeGeneration.current) return;
        loadedDirs.current.add(path);
        setDirectories((current) => ({ ...current, [path]: listing }));
        setDirErrors((current) => {
          if (!(path in current)) return current;
          const next = { ...current };
          delete next[path];
          return next;
        });
      } catch (caught) {
        if (generation !== treeGeneration.current) return;
        setDirErrors((current) => ({ ...current, [path]: errorText(caught) }));
      } finally {
        if (generation === treeGeneration.current) {
          loadingDirs.current.delete(path);
          setDirLoading((current) => {
            if (!(path in current)) return current;
            const next = { ...current };
            delete next[path];
            return next;
          });
        }
      }
    },
    [agent.id, agent.workspaceDir],
  );

  useEffect(() => {
    treeGeneration.current += 1;
    loadedDirs.current.clear();
    loadingDirs.current.clear();
    setDirectories({});
    setDirLoading({});
    setDirErrors({});
    setExpanded(new Set());
    setFilter("");
    setChangedOnly(false);
    setRefsOpen(true);
    setChangedOpen(true);
    if (agent.workspaceDir) {
      void loadDir("");
    } else {
      setDirErrors({ "": "Pick a workspace folder for this agent first" });
    }
  }, [agent.workspaceDir, loadDir]);

  const expandTo = useCallback(
    async (path: string): Promise<void> => {
      const dirs = ancestorDirectories(path);
      if (dirs.length === 0) return;
      setExpanded((current) => {
        const next = new Set(current);
        for (const dir of dirs) next.add(dir);
        return next;
      });
      await Promise.all(dirs.map((dir) => loadDir(dir)));
    },
    [loadDir],
  );

  useEffect(() => {
    if (lastChangeSets.current === null) {
      lastChangeSets.current = changeSets;
      return;
    }
    if (lastChangeSets.current === changeSets) return;
    lastChangeSets.current = changeSets;
    const paths = new Set([...loadedDirs.current, ...loadingDirs.current]);
    if (paths.size === 0) return;
    treeGeneration.current += 1;
    loadedDirs.current.clear();
    loadingDirs.current.clear();
    setDirLoading({});
    for (const path of paths) void loadDir(path);
  }, [changeSets, loadDir]);

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
        setCodePath(request.path);
        setFilter("");
        setChangedOnly(false);
        setRefsOpen(Boolean(request.related && request.related.length > 0));
        void expandTo(request.path);
        if (match) {
          setSelectedTurnId(match.turnId);
          setSelectedFileId(match.file.id);
          setChangedOpen(true);
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

      const requestedTurn = request.turnId
        ? changeSets.find((change) => change.turnId === request.turnId) ?? null
        : null;
      if (request.turnId && !requestedTurn && loading) return;
      const turn = requestedTurn ?? changeSets[0] ?? null;
      appliedRequest.current = request;
      setCitation(null);
      setCodePath(null);
      setView("diff");
      setFilter("");
      setChangedOnly(false);
      setRefsOpen(false);
      setChangedOpen(true);
      if (turn) {
        const file =
          request.fileId && turn.files.some((item) => item.id === request.fileId)
            ? turn.files.find((item) => item.id === request.fileId) ?? null
            : turn.files[0] ?? null;
        setSelectedTurnId(turn.turnId);
        setSelectedFileId(file?.id ?? null);
        if (file) {
          setCodePath(file.path);
          void expandTo(file.path);
        }
      } else {
        setSelectedTurnId(null);
        setSelectedFileId(null);
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
    if (view === "code") return;

    const turn = changeSets.find((change) => change.turnId === selectedTurnId) ?? changeSets[0] ?? null;
    if (!turn) {
      setSelectedTurnId(null);
      setSelectedFileId(null);
      return;
    }
    const nextFile =
      (selectedFileId ? turn.files.find((file) => file.id === selectedFileId) : null) ??
      turn.files[0] ??
      null;
    setSelectedTurnId(turn.turnId);
    setSelectedFileId(nextFile?.id ?? null);
    if (nextFile) {
      setCodePath(nextFile.path);
      void expandTo(nextFile.path);
    }
  }, [changeSets, citation, expandTo, loading, request, selectedFileId, selectedTurnId, view]);

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

  useEffect(() => {
    const focusFilter = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      filterInput.current?.focus();
      filterInput.current?.select();
    };
    document.addEventListener("keydown", focusFilter);
    return () => document.removeEventListener("keydown", focusFilter);
  }, []);

  const selectedTurn =
    changeSets.find((change) => change.turnId === selectedTurnId) ?? changeSets[0] ?? null;
  const selectedFile =
    view === "diff"
      ? selectedTurn?.files.find((file) => file.id === selectedFileId) ??
        selectedTurn?.files[0] ??
        null
      : null;
  const totals = changeTotals(selectedTurn);
  const related = request?.related ?? [];
  const activePath = view === "diff" ? selectedFile?.path ?? null : codePath;
  const activeKey = activePath ? normalizeWorkspacePath(activePath) : null;
  const activeIsImage = activePath ? imageMimeForPath(activePath) !== null : false;
  const showCitation = Boolean(
    citation &&
      activeKey &&
      normalizeWorkspacePath(citation.path) === activeKey &&
      !activeIsImage,
  );
  const codeChange = codePath ? findChangedFile(changeSets, codePath) : null;
  const codeCitation = showCitation ? citation : null;
  const citedStart =
    view === "diff" &&
    citation &&
    selectedFile &&
    normalizeWorkspacePath(citation.path) === normalizeWorkspacePath(selectedFile.path)
      ? citation.line
      : null;
  const citedEnd = citedStart === null ? null : (citation?.endLine ?? citedStart);
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

  function selectFile(file: FileChangeSummary) {
    setCitation(null);
    setView("diff");
    setSelectedFileId(file.id);
    setCodePath(file.path);
    setFilter("");
    setChangedOnly(false);
    setChangedOpen(true);
    void expandTo(file.path);
  }

  function selectTurn(turnId: string) {
    const change = changeSets.find((candidate) => candidate.turnId === turnId);
    setSelectedTurnId(turnId);
    setSelectedFileId(change?.files[0]?.id ?? null);
    setCodePath(change?.files[0]?.path ?? null);
    setFilter("");
    setChangedOnly(false);
    setTurnMenu(false);
    setCitation(null);
    setView("diff");
    setChangedOpen(true);
    if (change?.files[0]) void expandTo(change.files[0].path);
  }

  function selectReference(reference: Citation) {
    const next: CitationView = {
      path: reference.path,
      line: reference.line,
      endLine: reference.endLine,
    };
    setCitation(next);
    setCodePath(reference.path);
    setFilter("");
    setChangedOnly(false);
    setRefsOpen(true);
    void expandTo(reference.path);
    const match = findChangedFile(changeSets, reference.path);
    if (match) {
      setSelectedTurnId(match.turnId);
      setSelectedFileId(match.file.id);
      setChangedOpen(true);
      setView("diff");
    } else {
      setSelectedFileId(null);
      setView("code");
    }
  }

  function selectWorkspaceFile(path: string) {
    setCitation(null);
    setView("code");
    setCodePath(path);
    setSelectedFileId(null);
    void expandTo(path);
  }

  function viewDiffForPath(path: string) {
    const match = findChangedFile(changeSets, path);
    if (!match) return;
    setCitation(null);
    setSelectedTurnId(match.turnId);
    setSelectedFileId(match.file.id);
    setCodePath(path);
    setView("diff");
    setChangedOpen(true);
    void expandTo(path);
  }

  function toggleDir(path: string) {
    const open = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!open) void loadDir(path);
  }

  async function revertTurn() {
    if (!selectedTurn) return;
    await fid().changes.revertTurn(selectedTurn.turnId);
    setConfirm(null);
    setCitation(null);
    setView("diff");
    setSelectedFileId(null);
    setCodePath(null);
    setFilter("");
    setChangedOnly(false);
    await onRefresh();
  }

  async function revertFile() {
    if (!selectedFile) return;
    await fid().changes.revert(selectedFile.id);
    setConfirm(null);
    setCitation(null);
    setView("diff");
    setSelectedFileId(null);
    setCodePath(null);
    setFilter("");
    setChangedOnly(false);
    await onRefresh();
  }

  const canRevertTurn =
    selectedTurn !== null &&
    selectedTurn.files.length > 0 &&
    selectedTurn.status !== null &&
    selectedTurn.files.every((file) => file.revertible);
  const canRevertFile = selectedFile?.revertible === true;

  return (
    <>
      <aside ref={panel} className="changes-panel" aria-label="Workspace" tabIndex={-1}>
        <header className="changes-head">
          <div className="changes-head-copy">
            <div className="changes-kicker">{agent.name}</div>
            <div className="changes-title">Workspace</div>
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
                            <span>
                              {change.turnId === changeSets[0]?.turnId
                                ? "Last turn"
                                : formatRelativeTime(change.startedAt)}
                            </span>
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
            <button
              type="button"
              className="icon-button changes-chat-toggle"
              aria-label={chatCollapsed ? "Show chat" : "Collapse chat"}
              title={chatCollapsed ? "Show the chat" : "Slide the chat left"}
              onClick={onToggleChat}
            >
              {chatCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
            <button type="button" className="icon-button" aria-label="Close changes" onClick={onClose}>
              <X size={15} />
            </button>
          </div>
        </header>

        {showCitation && citation ? (
          <div className="changes-cite-context">
            <span>From citation</span>
            <code>
              {citation.path}:{rangeLabel(citation.line, citation.endLine)}
            </code>
            <span className="changes-cite-note">
              {view === "diff"
                ? "Cited lines are marked in the diff."
                : "Cited lines are marked in the file."}
            </span>
          </div>
        ) : null}

        <div className="changes-body">
          {view === "diff" ? (
            selectedFile ? (
              <section className="changes-diff-pane" aria-label="Selected file diff">
                <header className="changes-diff-head">
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
            ) : (
              <ViewerPlaceholder hasWorkspace={Boolean(agent.workspaceDir)} loading={loading} />
            )
          ) : codePath ? (
            <WorkspaceCodePane
              agentId={agent.id}
              path={codePath}
              line={codeCitation?.line ?? null}
              endLine={codeCitation?.endLine ?? null}
              changed={codeChange?.file ?? null}
              onViewDiff={() => viewDiffForPath(codePath)}
            />
          ) : (
            <ViewerPlaceholder hasWorkspace={Boolean(agent.workspaceDir)} loading={loading} />
          )}

          <WorkspaceNavigator
            related={related}
            citation={citation}
            changeSets={changeSets}
            selectedTurn={selectedTurn}
            totals={totals}
            refsOpen={refsOpen}
            changedOpen={changedOpen}
            onToggleRefs={() => setRefsOpen((open) => !open)}
            onToggleChanged={() => setChangedOpen((open) => !open)}
            filter={filter}
            onFilter={setFilter}
            filterInput={filterInput}
            changedOnly={changedOnly}
            onChangedOnly={setChangedOnly}
            directories={directories}
            dirLoading={dirLoading}
            dirErrors={dirErrors}
            expanded={expanded}
            onToggleDir={toggleDir}
            onSelectFile={selectFile}
            onSelectReference={selectReference}
            onSelectWorkspaceFile={selectWorkspaceFile}
            activePath={activePath}
            changesLoading={loading}
            changesError={error}
            onRefresh={onRefresh}
          />
        </div>
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

function ViewerPlaceholder({ hasWorkspace, loading }: { hasWorkspace: boolean; loading: boolean }) {
  if (!hasWorkspace) {
    return (
      <section className="changes-diff-pane" aria-label="Workspace file">
        <div className="changes-empty">
          <Folder size={20} aria-hidden="true" />
          <strong>No workspace folder</strong>
          <span>Pick a folder for this agent to browse its files.</span>
        </div>
      </section>
    );
  }
  if (loading) {
    return (
      <section className="changes-diff-pane" aria-label="Workspace file">
        <div className="changes-empty">
          <Loader2 size={15} className="spin" aria-hidden="true" />
          Loading changes…
        </div>
      </section>
    );
  }
  return (
    <section className="changes-diff-pane" aria-label="Workspace file">
      <div className="changes-empty">
        <FileText size={20} aria-hidden="true" />
        <strong>Select a file</strong>
        <span>Choose a file from All files, a reference, or a changed file.</span>
      </div>
    </section>
  );
}

