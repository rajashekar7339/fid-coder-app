import { diffLines } from "../../shared/diff";
import type { FileDiff } from "../../shared/types";

export function DiffView({ diff }: { diff: FileDiff }) {
  const result = diffLines(diff.before ?? "", diff.after ?? "");
  const truncated = diff.truncated || result.truncated;

  return (
    <div className="diff-view">
      <div className="diff-meta">
        <span className={`change-kind is-${diff.kind}`}>{diff.kind === "create" ? "new file" : "edited"}</span>
        <span className="diff-path">{diff.path}</span>
        <span className="diff-stats">
          <span className="diff-add">+{result.additions}</span>
          <span className="diff-remove">−{result.deletions}</span>
        </span>
      </div>
      {diff.note ? <p className="diff-note">{diff.note}</p> : null}
      {diff.kind === "update" && diff.before === null ? (
        <p className="diff-note">The original content was not saved, so this diff starts from an empty file.</p>
      ) : null}
      {diff.after === null ? <p className="diff-note">The file is missing or was removed.</p> : null}
      <div className="diff-lines" role="list" aria-label={`Diff for ${diff.path}`}>
        {result.lines.length === 0 ? <p className="diff-empty">No text changes.</p> : null}
        {result.lines.map((line, index) => (
          <div key={index} className={`diff-line is-${line.kind}`} role="listitem">
            <span className="diff-no" aria-hidden="true">
              {line.oldLine ?? ""}
            </span>
            <span className="diff-no" aria-hidden="true">
              {line.newLine ?? ""}
            </span>
            <span className="diff-sign" aria-hidden="true">
              {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
            </span>
            <span className="diff-text">{line.text || " "}</span>
          </div>
        ))}
      </div>
      {truncated ? <p className="diff-note">Diff was truncated for this large file.</p> : null}
    </div>
  );
}
