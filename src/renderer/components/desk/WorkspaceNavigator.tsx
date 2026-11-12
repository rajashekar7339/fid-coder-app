import { Fragment, useMemo, type RefObject } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
} from "lucide-react";
import {
  buildPathTree,
  normalizeWorkspacePath,
  type FileTreeNode,
} from "../../../shared/file-tree";
import { findChangedFile } from "../../../shared/changes";
import type { Citation } from "../../../shared/citations";
import type {
  ChangeSet,
  FileChangeSummary,
  WorkspaceDirectory,
} from "../../../shared/types";
import {
  directoryName,
  fileName,
  rangeLabel,
  referenceLabel,
  type CitationView,
} from "./workspace-labels";

export function WorkspaceNavigator({
  related,
  citation,
  changeSets,
  selectedTurn,
  totals,
  refsOpen,
  changedOpen,
  onToggleRefs,
  onToggleChanged,
  filter,
  onFilter,
  filterInput,
  changedOnly,
  onChangedOnly,
  directories,
  dirLoading,
  dirErrors,
  expanded,
  onToggleDir,
  onSelectFile,
  onSelectReference,
  onSelectWorkspaceFile,
  activePath,
  changesLoading,
  changesError,
  onRefresh,
}: {
  related: Citation[];
  citation: CitationView | null;
  changeSets: ChangeSet[];
  selectedTurn: ChangeSet | null;
  totals: { additions: number; deletions: number };
  refsOpen: boolean;
  changedOpen: boolean;
  onToggleRefs: () => void;
  onToggleChanged: () => void;
  filter: string;
  onFilter: (value: string) => void;
  filterInput: RefObject<HTMLInputElement | null>;
  changedOnly: boolean;
  onChangedOnly: (value: boolean) => void;
  directories: Record<string, WorkspaceDirectory>;
  dirLoading: Record<string, boolean>;
  dirErrors: Record<string, string>;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (file: FileChangeSummary) => void;
  onSelectReference: (reference: Citation) => void;
  onSelectWorkspaceFile: (path: string) => void;
  activePath: string | null;
  changesLoading: boolean;
  changesError: string | null;
  onRefresh: () => Promise<void> | void;
}) {
  const activeKey = activePath ? normalizeWorkspacePath(activePath) : null;
  const changedByPath = useMemo(() => {
    const map = new Map<string, FileChangeSummary>();
    for (const file of selectedTurn?.files ?? []) {
      map.set(normalizeWorkspacePath(file.path), file);
    }
    return map;
  }, [selectedTurn]);
  const loadedFiles = useMemo(() => {
    const paths = new Set<string>();
    for (const listing of Object.values(directories)) {
      for (const entry of listing.entries) {
        if (entry.kind === "file") paths.add(entry.path);
      }
    }
    return [...paths].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [directories]);
  const query = filter.trim().toLowerCase();
  const visiblePaths = useMemo(() => {
    if (changedOnly) {
      const paths = selectedTurn?.files.map((file) => file.path) ?? [];
      return query ? paths.filter((path) => path.toLowerCase().includes(query)) : paths;
    }
    if (!query) return null;
    return loadedFiles.filter((path) => path.toLowerCase().includes(query));
  }, [changedOnly, loadedFiles, query, selectedTurn]);
  const filterNodes = useMemo(
    () => (visiblePaths ? buildPathTree(visiblePaths) : []),
    [visiblePaths],
  );
  const filtering = query.length > 0 || changedOnly;
  return (
    <aside className="changes-tree changes-navigator" aria-label="Workspace navigator">
      {related.length > 0 ? (
        <section className="changes-nav-section">
          <button
            type="button"
            className="changes-nav-head"
            aria-expanded={refsOpen}
            onClick={onToggleRefs}
          >
            {refsOpen ? (
              <ChevronDown size={11} aria-hidden="true" />
            ) : (
              <ChevronRight size={11} aria-hidden="true" />
            )}
            <span className="changes-nav-title">References</span>
            <span className="changes-nav-count">{related.length}</span>
          </button>
          {refsOpen ? (
            <div className="changes-refs changes-nav-body" aria-label="Code references in this answer">
              <div className="changes-refs-list">
                <ReferenceList
                  references={related}
                  citation={citation}
                  changeSets={changeSets}
                  onSelect={onSelectReference}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="changes-nav-section">
        <button
          type="button"
          className="changes-nav-head"
          aria-expanded={changedOpen}
          onClick={onToggleChanged}
        >
          {changedOpen ? (
            <ChevronDown size={11} aria-hidden="true" />
          ) : (
            <ChevronRight size={11} aria-hidden="true" />
          )}
          <span className="changes-nav-title">Changed</span>
          <span className="changes-nav-count">{selectedTurn?.files.length ?? 0}</span>
          {selectedTurn ? (
            <span className="changes-nav-totals">
              <span className="diff-add">+{totals.additions}</span>
              <span className="diff-remove">−{totals.deletions}</span>
            </span>
          ) : null}
        </button>
        {changedOpen ? (
          changesError ? (
            <div className="changes-nav-error" role="alert">
              <span>{changesError}</span>
              <button type="button" className="btn btn-secondary" onClick={() => void onRefresh()}>
                Try again
              </button>
            </div>
          ) : changesLoading && !selectedTurn ? (
            <div className="changes-nav-loading">
              <Loader2 size={13} className="spin" aria-hidden="true" />
              Loading changes…
            </div>
          ) : selectedTurn && selectedTurn.files.length > 0 ? (
            <div className="changes-tree-list" aria-label="Changed files">
              {selectedTurn.files.map((file) => {
                const active = activeKey !== null && normalizeWorkspacePath(file.path) === activeKey;
                return (
                  <button
                    key={file.id}
                    type="button"
                    className={`changes-tree-file ${active ? "is-active" : ""}`}
                    title={file.path}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectFile(file)}
                  >
                    <FileText size={11} aria-hidden="true" />
                    <span className="changes-tree-name">{file.path}</span>
                    {file.kind === "create" ? <span className="changes-tree-new" title="New file" /> : null}
                    <span className="changes-tree-stats">
                      <span className="diff-add">+{file.additions}</span>
                      <span className="diff-remove">−{file.deletions}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="changes-tree-empty">No recorded changes for this turn.</p>
          )
        ) : null}
      </section>

      <section className="changes-nav-section changes-nav-files">
        <div className="changes-nav-head is-static">
          <Folder size={11} aria-hidden="true" />
          <span className="changes-nav-title">All files</span>
        </div>
        <div className="changes-tree-search">
          <input
            ref={filterInput}
            value={filter}
            onChange={(event) => onFilter(event.target.value)}
            placeholder="Filter loaded files…"
            aria-label="Filter workspace files"
            title="Filter loaded files (Ctrl+P)"
            autoComplete="off"
          />
        </div>
        <label className="changes-nav-toggle">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => onChangedOnly(event.target.checked)}
          />
          Changed only
        </label>
        <div className="workspace-tree-list">
          {dirErrors[""] && !directories[""] ? (
            <p className="changes-tree-empty is-error">{dirErrors[""]}</p>
          ) : dirLoading[""] && !directories[""] ? (
            <div className="changes-nav-loading">
              <Loader2 size={13} className="spin" aria-hidden="true" />
              Reading folder…
            </div>
          ) : filtering ? (
            filterNodes.length > 0 ? (
              <FilteredTree
                nodes={filterNodes}
                depth={0}
                activePath={activePath}
                changed={changedByPath}
                onSelect={onSelectWorkspaceFile}
              />
            ) : (
              <p className="changes-tree-empty">
                {changedOnly
                  ? filter.trim()
                    ? "No changed files match."
                    : "No changed files in this turn."
                  : "No loaded files match."}
              </p>
            )
          ) : directories[""] ? (
            directories[""].entries.length > 0 ? (
              <LazyTree
                path=""
                depth={0}
                directories={directories}
                loading={dirLoading}
                errors={dirErrors}
                expanded={expanded}
                onToggle={onToggleDir}
                onSelect={onSelectWorkspaceFile}
                activePath={activePath}
                changed={changedByPath}
              />
            ) : (
              <p className="changes-tree-empty">No files in this workspace.</p>
            )
          ) : null}
        </div>
        <footer className="changes-tree-foot">
          <span>workspace root</span>
          <span>
            {filter.trim()
              ? changedOnly
                ? "changed files"
                : `${loadedFiles.length} loaded`
              : changedOnly
                ? "changed only"
                : "lazy tree"}
          </span>
        </footer>
      </section>
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
    <>
      {references.map((reference) => {
        const current =
          citation !== null &&
          normalizeWorkspacePath(citation.path) === normalizeWorkspacePath(reference.path) &&
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
    </>
  );
}

function FilteredTree({
  nodes,
  depth,
  activePath,
  changed,
  onSelect,
}: {
  nodes: FileTreeNode[];
  depth: number;
  activePath: string | null;
  changed: Map<string, FileChangeSummary>;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <Fragment key={node.path}>
            <div
              className="workspace-tree-folder is-static"
              style={{ paddingLeft: 8 + depth * 13 }}
            >
              <Folder size={11} aria-hidden="true" />
              <span className="workspace-tree-name">{node.name}</span>
            </div>
            <FilteredTree
              nodes={node.children}
              depth={depth + 1}
              activePath={activePath}
              changed={changed}
              onSelect={onSelect}
            />
          </Fragment>
        ) : (
          <WorkspaceFileRow
            key={node.path}
            path={node.path}
            name={node.name}
            depth={depth}
            activePath={activePath}
            changed={changed}
            onSelect={onSelect}
          />
        ),
      )}
    </>
  );
}

function LazyTree({
  path,
  depth,
  directories,
  loading,
  errors,
  expanded,
  onToggle,
  onSelect,
  activePath,
  changed,
}: {
  path: string;
  depth: number;
  directories: Record<string, WorkspaceDirectory>;
  loading: Record<string, boolean>;
  errors: Record<string, string>;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  activePath: string | null;
  changed: Map<string, FileChangeSummary>;
}) {
  const listing = directories[path];
  if (!listing) return null;
  return (
    <>
      {listing.entries.map((entry) => {
        if (entry.kind === "dir") {
          const open = expanded.has(entry.path);
          const child = directories[entry.path];
          const childLoading = loading[entry.path] === true;
          const childError = errors[entry.path];
          return (
            <Fragment key={entry.path}>
              <button
                type="button"
                className="workspace-tree-folder"
                style={{ paddingLeft: 8 + depth * 13 }}
                aria-expanded={open}
                onClick={() => onToggle(entry.path)}
              >
                {open ? (
                  <ChevronDown size={10} aria-hidden="true" />
                ) : (
                  <ChevronRight size={10} aria-hidden="true" />
                )}
                <Folder size={11} aria-hidden="true" />
                <span className="workspace-tree-name">{entry.name}</span>
              </button>
              {open ? (
                childLoading && !child ? (
                  <div className="workspace-tree-note" style={{ paddingLeft: 22 + depth * 13 }}>
                    <Loader2 size={10} className="spin" aria-hidden="true" /> Loading…
                  </div>
                ) : childError ? (
                  <div
                    className="workspace-tree-note is-error"
                    style={{ paddingLeft: 22 + depth * 13 }}
                    role="alert"
                  >
                    {childError}
                  </div>
                ) : child ? (
                  child.entries.length > 0 ? (
                    <LazyTree
                      path={entry.path}
                      depth={depth + 1}
                      directories={directories}
                      loading={loading}
                      errors={errors}
                      expanded={expanded}
                      onToggle={onToggle}
                      onSelect={onSelect}
                      activePath={activePath}
                      changed={changed}
                    />
                  ) : (
                    <div className="workspace-tree-note" style={{ paddingLeft: 22 + depth * 13 }}>
                      No files.
                    </div>
                  )
                ) : null
              ) : null}
            </Fragment>
          );
        }
        return (
          <WorkspaceFileRow
            key={entry.path}
            path={entry.path}
            name={entry.name}
            depth={depth}
            activePath={activePath}
            changed={changed}
            onSelect={onSelect}
          />
        );
      })}
      {listing.truncated ? (
        <p className="workspace-tree-note" style={{ paddingLeft: 10 + depth * 13 }}>
          Showing the first {listing.entries.length} entries.
        </p>
      ) : null}
    </>
  );
}

function WorkspaceFileRow({
  path,
  name,
  depth,
  activePath,
  changed,
  onSelect,
}: {
  path: string;
  name: string;
  depth: number;
  activePath: string | null;
  changed: Map<string, FileChangeSummary>;
  onSelect: (path: string) => void;
}) {
  const active = activePath !== null && normalizeWorkspacePath(activePath) === normalizeWorkspacePath(path);
  const change = changed.get(normalizeWorkspacePath(path)) ?? null;
  return (
    <button
      type="button"
      className={`workspace-tree-file ${active ? "is-active" : ""}`}
      style={{ paddingLeft: 12 + depth * 13 }}
      title={path}
      aria-current={active ? "true" : undefined}
      onClick={() => onSelect(path)}
    >
      <FileText size={11} aria-hidden="true" />
      <span className="workspace-tree-name">{name}</span>
      {change ? (
        <span className="workspace-tree-dot" title="Changed in the selected turn" aria-hidden="true" />
      ) : null}
      {change ? (
        <span className="changes-tree-stats">
          <span className="diff-add">+{change.additions}</span>
          <span className="diff-remove">−{change.deletions}</span>
        </span>
      ) : null}
    </button>
  );
}
