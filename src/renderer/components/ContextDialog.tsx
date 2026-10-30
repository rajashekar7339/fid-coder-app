import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Agent, ContextView } from "../../shared/types";
import { errorText, fid } from "../fid";
import { Modal } from "./Modal";

export function ContextDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [view, setView] = useState<ContextView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fid()
      .context.preview(agent.id)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  return (
    <Modal label={`Context for ${agent.name}`} className="context-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">{agent.name}</div>
          <div className="modal-title">What the agent sees</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close context" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="context-body">
        {error ? (
          <p className="context-error" role="alert">
            {error}
          </p>
        ) : view === null ? (
          <p className="context-empty">Reading context…</p>
        ) : (
          <>
            <div className="context-facts">
              <div>
                <span>Model</span>
                <strong>{view.model}</strong>
              </div>
              <div>
                <span>Tools</span>
                <strong>{view.tools.length}</strong>
              </div>
              <div>
                <span>System</span>
                <strong>{formatChars(view.chars.system)}</strong>
              </div>
              <div>
                <span>Memory</span>
                <strong>{formatChars(view.chars.memory)}</strong>
              </div>
            </div>
            <p className="context-tools">
              {view.toolProfile} profile · {view.tools.join(", ")}
            </p>
            <p className="context-note">Credentials are never included in the system message.</p>

            <section className="context-section">
              <h3>System message</h3>
              <pre className="context-block">{view.systemMessage || "(empty)"}</pre>
            </section>
            <section className="context-section">
              <h3>Memory</h3>
              <pre className="context-block">{view.memorySummary || "(empty)"}</pre>
            </section>
            <section className="context-section">
              <h3>Workspace brief</h3>
              <pre className="context-block">{view.workspaceBrief || "(not available)"}</pre>
            </section>
            <section className="context-section">
              <h3>Project rules files</h3>
              {view.rules.length > 0 ? (
                <ul className="context-rules">
                  {view.rules.map((file) => (
                    <li key={file.path}>
                      <span>{file.path}</span>
                      <span>
                        {formatChars(file.chars)}
                        {file.truncated ? " · truncated" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="context-empty">No project rules files were found.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function formatChars(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k chars`;
  return `${value} chars`;
}
