import { useEffect, useRef, useState } from "react";
import { Loader2, Map as MapIcon, RefreshCw, X } from "lucide-react";
import type { Citation } from "../../../shared/citations";
import type { Agent, WorkspaceMapView } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatFullTimestamp } from "../../lib/format";
import { Modal } from "../ui/Modal";
import { MessageContent } from "./MessageContent";

type Props = {
  agent: Agent;
  signedIn: boolean;
  onClose: () => void;
  onOpenFile: (path: string, line: number, endLine: number | null, related: Citation[]) => void;
};

export function ProjectMapDialog({ agent, signedIn, onClose, onOpenFile }: Props) {
  const [view, setView] = useState<WorkspaceMapView | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const id = ++request.current;
    setLoading(true);
    setError(null);
    void fid()
      .workspace.map(agent.id)
      .then((next) => {
        if (cancelled || request.current !== id) return;
        setView(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled && request.current === id) setError(errorText(caught));
      })
      .finally(() => {
        if (!cancelled && request.current === id) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  async function buildMap() {
    if (building || !signedIn) return;
    const id = ++request.current;
    setBuilding(true);
    setError(null);
    try {
      const next = await fid().workspace.buildMap(agent.id);
      if (request.current === id) setView(next);
    } catch (caught) {
      if (request.current === id) setError(errorText(caught));
    } finally {
      if (request.current === id) setBuilding(false);
    }
  }

  const busy = loading || building;

  return (
    <Modal label="Project map" className="project-map-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">{agent.name}</div>
          <div className="modal-title">Project map</div>
        </div>
        <div className="map-head-actions">
          {view ? (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !signedIn}
              title={signedIn ? "Refresh the map with a read-only exploration" : "Sign in to refresh the map"}
              onClick={() => void buildMap()}
            >
              {building ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <RefreshCw size={13} />}
              {building ? "Building…" : "Refresh map"}
            </button>
          ) : null}
          <button type="button" className="icon-button" aria-label="Close project map" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="map-body" aria-busy={busy}>
        {loading ? (
          <div className="map-empty">
            <Loader2 size={16} className="spin" aria-hidden="true" />
            <strong>Reading the saved map…</strong>
          </div>
        ) : error ? (
          <div className="map-empty is-error" role="alert">
            <strong>Could not prepare the map.</strong>
            <span>{error}</span>
            {signedIn ? (
              <button type="button" className="btn btn-secondary" onClick={() => void buildMap()}>
                Try again
              </button>
            ) : null}
          </div>
        ) : view ? (
          <>
            <div className="map-meta">
              <span>Built {formatFullTimestamp(view.generatedAt)}</span>
              {view.stale ? (
                <span className="map-stale">The repository changed since this map was built.</span>
              ) : (
                <span>Up to date</span>
              )}
            </div>
            <div className="map-content">
              <MessageContent text={view.text} onOpenFile={onOpenFile} />
            </div>
          </>
        ) : (
          <div className="map-empty">
            <MapIcon size={20} aria-hidden="true" />
            <strong>No project map yet</strong>
            <span>
              One read-only pass over the workspace: entry points, components, key flows, a reading order, and risks.
              Nothing is edited.
            </span>
            {signedIn ? (
              <button type="button" className="btn btn-primary" disabled={building} onClick={() => void buildMap()}>
                {building ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <MapIcon size={13} />}
                {building ? "Building…" : "Build map"}
              </button>
            ) : (
              <span className="map-sign-in">Sign in to Copilot to build a map.</span>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
