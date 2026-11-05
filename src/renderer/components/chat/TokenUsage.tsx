import { ChevronDown } from "lucide-react";
import type { TokenUsage as TokenUsageValue } from "../../../shared/types";
import { formatCount } from "../../lib/format";

export function TokenUsage({ usage, live = false }: { usage: TokenUsageValue; live?: boolean }) {
  const total = usage.inputTokens + usage.outputTokens;
  const cached = Math.min(usage.cacheReadTokens, usage.inputTokens);
  const freshInput = Math.max(0, usage.inputTokens - cached);
  const percent = (value: number) => (total > 0 ? `${(value / total) * 100}%` : "0%");

  return (
    <details className={live ? "token-usage is-live" : "token-usage"}>
      <summary className="token-usage-summary">
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 19V11" />
          <path d="M12 19V5" />
          <path d="M19 19v-5" />
        </svg>
        <b>{formatCount(total)} tokens</b>
        {usage.model ? (
          <>
            <span className="token-usage-sep">·</span>
            <span className="token-usage-model">{usage.model}</span>
          </>
        ) : null}
        {live ? <span className="token-usage-live" aria-label="Live count" /> : null}
        <ChevronDown size={11} className="token-usage-chev" aria-hidden="true" />
      </summary>

      <div className="token-usage-body">
        <div className="token-usage-stats">
          <div className="token-usage-stat">
            <span>Input</span>
            <b>{formatCount(usage.inputTokens)}</b>
          </div>
          <div className="token-usage-stat">
            <span>Output</span>
            <b>{formatCount(usage.outputTokens)}</b>
          </div>
          <div className="token-usage-stat">
            <span>Cache read</span>
            <b>{formatCount(cached)}</b>
          </div>
          <div className="token-usage-stat">
            <span>Model calls</span>
            <b>{usage.modelCalls}</b>
          </div>
        </div>

        <div className="token-usage-composition">
          <div className="token-usage-comp-head">
            <span>Token composition</span>
            <span>{formatCount(total)} total</span>
          </div>
          <div
            className="token-usage-bar"
            role="img"
            aria-label={`${formatCount(cached)} cached tokens, ${formatCount(freshInput)} new input tokens, ${formatCount(usage.outputTokens)} output tokens`}
          >
            {cached > 0 ? <i className="seg-cached" style={{ width: percent(cached) }} /> : null}
            {freshInput > 0 ? <i className="seg-input" style={{ width: percent(freshInput) }} /> : null}
            {usage.outputTokens > 0 ? (
              <i className="seg-output" style={{ width: percent(usage.outputTokens) }} />
            ) : null}
          </div>
          <div className="token-usage-legend">
            <span>
              <i className="dot-cached" />
              Cached {formatCount(cached)}
            </span>
            <span>
              <i className="dot-input" />
              New input {formatCount(freshInput)}
            </span>
            <span>
              <i className="dot-output" />
              Output {formatCount(usage.outputTokens)}
            </span>
          </div>
        </div>

        <p className="token-usage-note">Cached tokens are part of input; they are not counted twice.</p>
      </div>
    </details>
  );
}
