import {
  Bot,
  FileText,
  GitBranch,
  Globe2,
  Inbox,
  Search,
  Terminal,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import type { Agent } from "../shared/types";

const AGENT_COLORS = ["#e9b974", "#a5b8ed", "#8fd7ba", "#d7a8f2", "#8fc8ef", "#e5a1a2"];

type AgentIdentity = Pick<Agent, "id" | "name" | "description" | "systemPrompt">;

export function agentVisual(agent: AgentIdentity): { Icon: LucideIcon; color: string } {
  return { Icon: agentIcon(agent), color: agentColor(agent) };
}

export function agentSubtitle(agent: Pick<Agent, "description">): string {
  return agent.description.trim() || "Local AI teammate";
}

export function isRecentlyActive(iso: string | null): boolean {
  if (!iso) return false;
  const time = Date.parse(iso);
  return Number.isFinite(time) && Date.now() - time < 15 * 60 * 1000;
}

function agentIcon(agent: AgentIdentity): LucideIcon {
  const text = `${agent.name} ${agent.description} ${agent.systemPrompt}`.toLowerCase();
  if (/jira|ticket|issue tracker/.test(text)) return Ticket;
  if (/git|github|pull request|code review|repository/.test(text)) return GitBranch;
  if (/inbox|mail|email|newsletter/.test(text)) return Inbox;
  if (/browse|browser|web|research|scrape/.test(text)) return Globe2;
  if (/file|document|writing|knowledge/.test(text)) return FileText;
  if (/shell|terminal|command|deploy/.test(text)) return Terminal;
  if (/search|discover|find/.test(text)) return Search;
  return Bot;
}

function agentColor(agent: AgentIdentity): string {
  let hash = 0;
  for (const char of `${agent.id}${agent.name}`) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length] ?? AGENT_COLORS[0]!;
}
