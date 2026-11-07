import { useEffect, useState } from "react";
import { FileText, Loader2, X } from "lucide-react";
import type { WorkspaceFilePeek } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { Modal } from "../ui/Modal";

type Props = {
  agentId: string;
  path: string;
  line: number;
  onClose: () => void;
};

export function FilePeekDialog({ agentId, path, line, onClose }: Props) {
  const [view, setView] = useState<WorkspaceFilePeek | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView(null);
    void fid()
      .workspace.file(agentId, path, line)
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
  }, [agentId, path, line]);

  const lines = view?.text.split("\n") ?? [];

  return (
    <Modal label={`File ${path}`} className="file-peek-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Read-only file</div>
          <div className="modal-title file-peek-title">{path}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close file preview" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="file-peek-body">
        {loading ? (
          <div className="file-peek-empty">
            <Loader2 size={15} className="spin" aria-hidden="true" />
            Reading the file…
          </div>
        ) : error ? (
          <div className="file-peek-empty is-error" role="alert">
            <FileText size={18} aria-hidden="true" />
            <strong>Could not open this file.</strong>
            <span>{error}</span>
          </div>
        ) : view ? (
          <>
            <div className="file-peek-meta">
              <span>
                Lines {view.startLine}–{view.endLine} of {view.totalLines}
              </span>
              {view.truncated ? <span>Preview is truncated</span> : null}
              {view.line ? <span className="file-peek-target">Line {view.line}</span> : null}
            </div>
            <pre className="file-peek-code" aria-label={`Contents of ${view.path}`}>
              {lines.length === 0 ? (
                <span className="file-peek-empty-line">(empty file)</span>
              ) : (
                lines.map((text, index) => {
                  const number = view.startLine + index;
                  return (
                    <span
                      key={number}
                      className={`file-peek-line ${number === view.line ? "is-target" : ""}`}
                    >
                      <span className="file-peek-line-number">{number}</span>
                      <span className="file-peek-line-text">{text || " "}</span>
                    </span>
                  );
                })
              )}
            </pre>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
