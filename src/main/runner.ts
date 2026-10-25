import type { Agent, ChatEvent, Message } from "../shared/types";
import { allTools } from "../tools/registry";
import type { ToolContext } from "../tools/types";
import type { BrowserManager } from "./browser-manager";
import { detach, openSession, readAssistantText, type LiveSession } from "./copilot";
import type { AppDatabase } from "./db";
import { getSecret, hasSecret, secretKeys } from "./secrets";

type Sink = (event: ChatEvent) => void;

type CachedSession = {
  signature: string;
  live: LiveSession;
  unsubscribe: () => void;
};

const TURN_TIMEOUT_MS = 8 * 60 * 1000;
const deltaHolders = new Map<string, (delta: string) => void>();

export class Runner {
  private sink: Sink = () => undefined;
  private readonly running = new Set<string>();
  private readonly sessions = new Map<string, CachedSession>();

  constructor(
    private readonly db: AppDatabase,
    private readonly browser: BrowserManager,
  ) {}

  setSink(sink: Sink): void {
    this.sink = sink;
  }

  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }

  async dropSession(agentId: string): Promise<void> {
    const cached = this.sessions.get(agentId);
    if (!cached) return;
    this.sessions.delete(agentId);
    cached.unsubscribe();
    await cached.live.session.disconnect?.();
  }

  async dropAllSessions(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.dropSession(id);
  }

  async abort(agentId: string): Promise<void> {
    await this.sessions.get(agentId)?.live.session.abort?.();
  }

  async runTurn(input: { agentId: string; text: string; source: "chat" | "routine" }): Promise<string> {
    const text = input.text.trim();
    if (!text) throw new Error("Message is empty");
    const agent = this.db.getAgent(input.agentId);
    if (!agent) throw new Error("Agent not found");
    if (this.running.has(agent.id)) throw new Error("This agent is already working");

    this.running.add(agent.id);
    let streamed = "";
    deltaHolders.set(agent.id, (delta) => {
      streamed += delta;
    });
    const visible = input.source === "routine" ? `[Routine] ${text}` : text;
    const userMessage = this.db.addMessage(agent.id, "user", visible);
    this.sink({ agentId: agent.id, type: "user", text: visible });

    try {
      const systemMessage = this.systemMessage(agent);
      const opened = await this.sessionFor(agent.id, agent.model, systemMessage);
      const prior = this.db
        .listMessages(agent.id)
        .filter((message) => message.id !== userMessage.id)
        .slice(-30);
      const prompt = buildPrompt(prior, text, input.source === "routine", opened.fresh);
      const response = await opened.live.session.sendAndWait({ prompt }, TURN_TIMEOUT_MS);
      const finalText = readAssistantText(response, streamed).trim() || streamed.trim() || "No response.";
      this.db.addMessage(agent.id, "assistant", finalText);
      this.sink({ agentId: agent.id, type: "done", text: finalText });
      return finalText;
    } catch (error) {
      const message = explainCopilotError(error instanceof Error ? error.message : String(error));
      const partial = streamed.trim();
      const stored = partial ? `${partial}\n\nStopped: ${message}` : `Stopped: ${message}`;
      this.db.addMessage(agent.id, "assistant", stored);
      this.sink({ agentId: agent.id, type: "error", error: message });
      throw new Error(message);
    } finally {
      deltaHolders.delete(agent.id);
      this.running.delete(agent.id);
    }
  }

  private async sessionFor(agentId: string, model: string, systemMessage: string): Promise<{ live: LiveSession; fresh: boolean }> {
    const signature = JSON.stringify([model, systemMessage]);
    const existing = this.sessions.get(agentId);
    if (existing && existing.signature === signature) {
      return { live: existing.live, fresh: false };
    }
    if (existing) await this.dropSession(agentId);

    const live = await openSession({
      model,
      systemMessage,
      tools: allTools(),
      getContext: () => this.context(agentId),
      onToolStart: (toolName, preview) => {
        this.sink({ agentId, type: "tool-start", toolName, text: preview });
      },
      onToolEnd: (toolName, ok, text) => {
        const clipped = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
        this.db.addMessage(agentId, "tool", `${toolName}: ${clipped}`);
        this.sink({ agentId, type: "tool-end", toolName, ok, text: clipped });
      },
    });

    const subscription = live.session.on((event) => {
      if (event.type !== "assistant.message_delta") return;
      const delta = typeof event.data?.deltaContent === "string" ? event.data.deltaContent : "";
      if (!delta) return;
      deltaHolders.get(agentId)?.(delta);
      this.sink({ agentId, type: "text", text: delta });
    });

    this.sessions.set(agentId, {
      signature,
      live,
      unsubscribe: () => detach(subscription),
    });
    return { live, fresh: true };
  }

  private context(agentId: string): ToolContext {
    const agent = this.db.getAgent(agentId);
    if (!agent) throw new Error("Agent not found");
    return {
      agentId,
      workspaceDir: agent.workspaceDir,
      browser: this.browser,
      githubPat: hasSecret(secretKeys.githubPat) ? getSecret(secretKeys.githubPat) : null,
      jiraToken: hasSecret(secretKeys.jira) ? getSecret(secretKeys.jira) : null,
      jiraSite: this.db.getSetting("jira_site_url"),
    };
  }

  private systemMessage(agent: Agent): string {
    const lines = [agent.systemPrompt];
    if (agent.workspaceDir) lines.push(`Workspace folder: ${agent.workspaceDir}`);
    const jiraSite = this.db.getSetting("jira_site_url");
    if (jiraSite) lines.push(`Jira site URL: ${jiraSite}`);
    if (hasSecret(secretKeys.jira)) {
      lines.push("A Jira API token is available to shell_run as JIRA_API_TOKEN. Do not print it or ask the user to paste it.");
    }
    if (hasSecret(secretKeys.githubPat)) {
      lines.push("A GitHub token is available to shell_run as GH_TOKEN. Do not print it.");
    }
    lines.push(
      "Browser tools control a headed browser on this Windows machine. This agent has its own persistent profile. Call browser_snapshot before browser_click or browser_type.",
    );
    return lines.join("\n\n");
  }
}

function explainCopilotError(message: string): string {
  if (/authorization|credential|access denied by policy/i.test(message)) {
    return `${message} GitHub is refusing Copilot requests for this login. Open https://github.com/settings/copilot, confirm Copilot is enabled, then use Settings and Copilot login.`;
  }
  if (/unknown model|invalid model|model .* not (found|available)|model is not available/i.test(message)) {
    return `${message} Choose Auto or another model for this agent.`;
  }
  return message;
}

function buildPrompt(prior: Message[], latest: string, routine: boolean, freshSession: boolean): string {
  const lead = routine ? "This turn was started by a schedule.\n\n" : "";
  if (!freshSession || prior.length === 0) return `${lead}${latest}`;
  const transcript = prior
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n")
    .slice(-12000);
  return `${lead}Previous conversation:\n${transcript}\n\nUser: ${latest}`;
}
