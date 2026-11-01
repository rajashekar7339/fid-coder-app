import { useState } from "react";
import type { SelectedTests } from "../../../shared/release-impact/types";

type Props = {
  selection: SelectedTests | null;
  error: string | null;
};

export function ImpactReport({ selection, error }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const must = selection?.mustRun ?? [];
  const risks = selection?.risks ?? [];
  const gaps = selection?.newScenarios ?? [];
  const reasons = selection?.fullRegressionReasons ?? [];

  async function copySelection() {
    if (!selection?.selectionText) return;
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(selection.selectionText);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyError("Could not copy the selection.");
    }
  }

  return (
    <section className="desk-section is-first">
      <div className="desk-section-head">
        <span>Release impact</span>
        <button
          type="button"
          className="text-button"
          disabled={!selection?.selectionText}
          onClick={() => void copySelection()}
        >
          {copied ? "Copied" : "Copy selection"}
        </button>
      </div>
      {error ? (
        <p className="desk-error" role="alert">
          {error}
        </p>
      ) : null}
      {copyError ? (
        <p className="desk-error" role="alert">
          {copyError}
        </p>
      ) : null}
      {!selection ? (
        <p className="desk-empty-line">No release selection yet. Ask this agent to run impact_analyze.</p>
      ) : (
        <>
          <p className={`impact-banner ${selection.fullRegression ? "is-full" : ""}`}>
            {selection.fullRegression ? "Full regression recommended" : "Selected tests only"}
          </p>
          {reasons.length > 0 ? (
            <ul className="impact-list">
              {reasons.slice(0, 4).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <p className="desk-note">Must run · {must.length}</p>
          {must.length === 0 ? (
            <p className="desk-empty-line">No must-run tests.</p>
          ) : (
            <ul className="impact-list">
              {must.slice(0, 8).map((test) => (
                <li key={`${test.id}:${test.file}`}>
                  <span className="impact-id">{test.id}</span>
                  <span className="impact-name">{test.name}</span>
                  <span className="impact-file">{test.file}</span>
                </li>
              ))}
            </ul>
          )}
          {must.length > 8 ? <p className="desk-note">{must.length - 8} more are in the selection file.</p> : null}
          {gaps.length > 0 ? (
            <>
              <p className="desk-note">Gaps</p>
              <ul className="impact-list">
                {gaps.slice(0, 4).map((gap) => (
                  <li key={gap.source}>
                    <span className="impact-name">{gap.title}</span>
                    <span className="impact-file">{gap.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {risks.length > 0 ? (
            <>
              <p className="desk-note">Risks</p>
              <ul className="impact-list">
                {risks.slice(0, 4).map((risk) => (
                  <li key={`${risk.source}:${risk.automation}:${risk.action}`}>
                    <span className="impact-name">{risk.action}</span>
                    <span className="impact-file">{risk.source}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {(selection.optionalRun?.length ?? 0) > 0 ? (
            <p className="desk-note">{selection.optionalRun.length} optional tests are in the selection file.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
