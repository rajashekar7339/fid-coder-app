import type { CSSProperties } from "react";
import type { Agent } from "../../shared/types";
import { agentVisual } from "../agent-display";

type Props = {
  agent: Pick<Agent, "id" | "name" | "description" | "systemPrompt">;
  size?: "xs" | "sm" | "md" | "lg";
  presence?: "recent" | "idle";
};

export function AgentAvatar({ agent, size = "md", presence }: Props) {
  const { Icon, color } = agentVisual(agent);
  return (
    <span
      className={`agent-glyph agent-glyph-${size}`}
      style={{ "--agent-color": color } as CSSProperties}
      aria-hidden="true"
    >
      <Icon strokeWidth={1.7} />
      {presence ? <span className={`glyph-presence glyph-presence-${presence}`} /> : null}
    </span>
  );
}
