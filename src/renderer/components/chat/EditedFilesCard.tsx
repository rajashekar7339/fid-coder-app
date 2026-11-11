import { useState } from "react";
import { ChevronDown, FileText, RotateCcw } from "lucide-react";
import { changeTotals } from "../../../shared/changes";
import type { ChangeSet, ChangesOpenRequest } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { ConfirmDialog } from "../ui/ConfirmDialog";

type Props = {
  change: ChangeSet;
  onOpenChanges: (request: ChangesOpenRequest) => void;
  onRefresh: () => void | Promise<void>;
};

export function EditedFilesCard({ change, onOpenChanges, onRefresh }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const totals = changeTotals(change);
  const visible = showAll ? change.files : change.files.slice(0, 4);
  const hidden = Math.max(0, change.files.length - 4);
  const canUndo =
    change.status !== null && change.files.length > 0 && change.files.every((file) => file.revertible);
  const undoTitle =
    change.status === null
      ? "Wait for the turn to finish"
      : change.files.some((file) => !file.revertible)
        ? "Some files cannot be restored"
        : "Restore every file this turn changed";

  async function revertTurn() {
    try {
      await fid().changes.revertTurn(change.turnId);
      setConfirming(false);
      await onRefresh();
    } catch (caught) {
      throw new Error(errorText(caught));
    }
  }

  return (
    <>
      <section className="edited-files-card" aria-label={`Edited ${change.files.length} files`}>
        <header className="edited-files-head">
          <div className="edited-files-title">
            <span className="edited-files-icon">
              <FileText size={12} aria-hidden="true" />
            </span>
            <span>
              Edited {change.files.length} file{change.files.length === 1 ? "" : "s"}
            </span>
            <span className="edited-files-stats">
              <span className="diff-add">+{totals.additions}</span>
              <span className="diff-remove">−{totals.deletions}</span>
            </span>
          </div>
          <div className="edited-files-actions">
            <button
              type="button"
              className="mini-btn"
              disabled={!canUndo}
              title={undoTitle}
              onClick={() => setConfirming(true)}
            >
              <RotateCcw size={10} aria-hidden="true" />
              Undo
            </button>
            <button
              type="button"
              className="mini-btn is-strong"
              onClick={() => onOpenChanges({ turnId: change.turnId })}
            >
              View changes
            </button>
          </div>
        </header>

        <div className="edited-files-list">
          {visible.map((file) => (
            <button
              key={file.id}
              type="button"
              className="edited-file-row"
              title={`Open ${file.path} in Changes`}
              onClick={() => onOpenChanges({ turnId: change.turnId, fileId: file.id })}
            >
              <FileText size={11} aria-hidden="true" />
              <span className="edited-file-name">{file.path}</span>
              <span className="edited-file-stats">
                <span className="diff-add">+{file.additions}</span>
                <span className="diff-remove">−{file.deletions}</span>
              </span>
            </button>
          ))}
          {hidden > 0 && !showAll ? (
            <button type="button" className="edited-file-more" onClick={() => setShowAll(true)}>
              <ChevronDown size={10} aria-hidden="true" />
              Show {hidden} more file{hidden === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>

        <p className="edited-files-note">
          {change.status === null
            ? "Recording changes…"
            : change.source === "routine"
              ? "Routine change · File tools only; shell changes are not recorded."
              : "File tools only; shell changes are not recorded."}
        </p>
      </section>

      {confirming ? (
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
          onCancel={() => setConfirming(false)}
          onConfirm={revertTurn}
        />
      ) : null}
    </>
  );
}
