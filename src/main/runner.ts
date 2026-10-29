import type { Agent, ChatEvent, Message } from "../shared/types";
import { toolsForAgent } from "../tools/registry";
import { summarizeTool } from "../shared/summary";
import type { ToolContext } from "../tools/types";
import type { BrowserManager } from "./browser-manager";
import { detach, getCopilotStatus, openSession, readAssistantText, type LiveSession } from "./copilot";
import type { AppDatabase } from "./db";
import { runCodeExplore } from "./explore-session";
import { getSecret, hasSecret, secretKeys } from "./secrets";
import { workspaceBrief } from "./workspace-brief";

const WORKSPACE_HINT =
  "A workspace brief is included below. Use it before searching. Explore with list_dir, glob_files, search_text, file_read, and read_many. For an unfamiliar area, call explore_code with a specific question. It returns a short brief and does not edit. Edit an existing file with apply_patch. Use file_write only to create a file. Use git_status, git_diff, and git_log for git. Use gh_pr_view and gh_pr_diff for a pull request. Use shell_run for builds, tests, and other commands. Do not use shell_run to list folders, search files, or read files.";

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
    const auth = await getCopilotStatus();
    if (!auth.signedIn) {
      throw new Error("Copilot is not signed in. Open Settings, sign in, then try again.");
    }

    this.running.add(agent.id);
    let streamed = "";
    deltaHolders.set(agent.id, (delta) => {
      streamed += delta;
    });
    const visible = input.source === "routine" ? `[Routine] ${text}` : text;
    const userMessage = this.db.addMessage(agent.id, "user", visible);
    this.sink({ agentId: agent.id, type: "user", text: visible });

    try {
      const systemMessage = await this.systemMessage(agent);
      const opened = await this.sessionFor(agent, systemMessage);
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

  private async sessionFor(agent: Agent, systemMessage: string): Promise<{ live: LiveSession; fresh: boolean }> {
    const signature = JSON.stringify([agent.model, systemMessage, agent.toolProfile]);
    const existing = this.sessions.get(agent.id);
    if (existing && existing.signature === signature) {
      return { live: existing.live, fresh: false };
    }
    if (existing) await this.dropSession(agent.id);

    const live = await openSession({
      model: agent.model,
      systemMessage,
      tools: toolsForAgent(agent.toolProfile),
      getContext: () => this.context(agent.id),
      onToolStart: (toolName, preview) => {
        this.sink({ agentId: agent.id, type: "tool-start", toolName, text: preview });
      },
      onToolEnd: (toolName, ok, text) => {
        const live = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
        this.db.addMessage(agent.id, "tool", summarizeTool(toolName, ok, live));
        this.sink({ agentId: agent.id, type: "tool-end", toolName, ok, text: live });
      },
    });

    const subscription = live.session.on((event) => {
      if (event.type !== "assistant.message_delta") return;
      const delta = typeof event.data?.deltaContent === "string" ? event.data.deltaContent : "";
      if (!delta) return;
      deltaHolders.get(agent.id)?.(delta);
      this.sink({ agentId: agent.id, type: "text", text: delta });
    });

    this.sessions.set(agent.id, {
      signature,
      live,
      unsubscribe: () => detach(subscription),
    });
    return { live, fresh: true };
  }

  private context(agentId: string): ToolContext {
    const agent = this.db.getAgent(agentId);
    if (!agent) throw new Error("Agent not found");
    const shellEnabled = agent.toolProfile !== "browser";
    const workspaceDir = agent.workspaceDir;
    return {
      agentId,
      workspaceDir,
      model: agent.model,
      browser: this.browser,
      githubPat: shellEnabled && hasSecret(secretKeys.githubPat) ? getSecret(secretKeys.githubPat) : null,
      jiraToken: shellEnabled && hasSecret(secretKeys.jira) ? getSecret(secretKeys.jira) : null,
      jiraSite: this.db.getSetting("jira_site_url"),
      explore:
        shellEnabled && workspaceDir
          ? (question) => runCodeExplore(this.context(agentId), question)
          : undefined,
    };
  }

  private async systemMessage(agent: Agent): Promise<string> {
    const shellEnabled = agent.toolProfile !== "browser";
    const browserEnabled = agent.toolProfile !== "developer";
    const lines = [agent.systemPrompt];
    if (shellEnabled && agent.workspaceDir) {
      lines.push(`Workspace folder: ${agent.workspaceDir}`);
      lines.push(WORKSPACE_HINT);
      const brief = await workspaceBrief(agent.workspaceDir);
      if (brief) lines.push(brief);
    }
    const jiraSite = this.db.getSetting("jira_site_url");
    if (jiraSite) lines.push(`Jira site URL: ${jiraSite}`);
    if (shellEnabled && hasSecret(secretKeys.jira)) {
      lines.push("A Jira API token is available to shell_run as JIRA_API_TOKEN. Do not print it or ask the user to paste it.");
    }
    if (shellEnabled && hasSecret(secretKeys.githubPat)) {
      lines.push("A GitHub token is available to shell_run as GH_TOKEN. Do not print it.");
    }
    if (shellEnabled) {
      lines.push(
        "Delete commands need the user's approval. For a delete request, call shell_run first; it returns DELETE_CONFIRM_REQUIRED. Then ask the user in chat. Only after their latest message explicitly approves, call shell_run again with confirmed: true.",
      );
    }
    if (browserEnabled) {
      lines.push(
        "Browser tools control a headed browser on this Windows machine. This agent has its own persistent profile. Call browser_snapshot before browser_click or browser_type.",
      );
    }
    return lines.join("\n\n");
  }
}

function explainCopilotError(message: string): string {
  if (/No GitHub OAuth token|Copilot HMAC key|not authenticated|authentication required/i.test(message)) {
    return "Copilot is not signed in. Open Settings, sign in, then try again.";
  }
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
