import {
  MEMORY_MESSAGE_WINDOW,
  buildSessionPrompt,
  clipMemorySummary,
  memoryTurns,
  pendingMemoryTurns,
  summaryUpdatePrompt,
} from "../../shared/memory-summary";
import { AUTO_MODEL_ID } from "../../shared/model";
import type { Agent, ChatEvent, ContextView } from "../../shared/types";
import { jiraToolsReady } from "../../tools/jira/jira-format";
import { toolsForAgent } from "../../tools/registry";
import { summarizeTool } from "../../shared/summary";
import type { ToolContext } from "../../tools/types";
import type { BrowserManager } from "../browser/browser-manager";
import type { CheckpointStore } from "../workspace/checkpoints";
import { completeOnce, detach, getCopilotStatus, openSession, readAssistantText, type LiveSession } from "../copilot";
import type { AppDatabase } from "../db";
import { runCodeExplore } from "../workspace/explore-session";
import { getSecret, hasSecret, secretKeys } from "../secrets";
import { workspaceBrief } from "../workspace/workspace-brief";
import { workspaceRules, type WorkspaceRules } from "../workspace/workspace-rules";

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

const PLAN_HINT =
  "For a task that needs three or more steps, call set_plan before you start and keep it current. Mark the step you are working on in_progress and finished steps done. Skip it for simple one-step requests.";

export class Runner {
  private sink: Sink = () => undefined;
  private readonly running = new Set<string>();
  private readonly sessions = new Map<string, CachedSession>();
  private readonly activeTurns = new Map<string, string>();

  constructor(
    private readonly db: AppDatabase,
    private readonly browser: BrowserManager,
    private readonly checkpoints: CheckpointStore,
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
    const turnId = this.db.createTurn(agent.id, input.source);
    this.activeTurns.set(agent.id, turnId);
    // Keep the last plan visible across turns; set_plan replaces it for a new task.
    let streamed = "";
    deltaHolders.set(agent.id, (delta) => {
      streamed += delta;
    });
    const visible = input.source === "routine" ? `[Routine] ${text}` : text;
    const userMessage = this.db.addMessage(agent.id, "user", visible, turnId);
    this.sink({ agentId: agent.id, type: "user", text: visible });

    try {
      const systemMessage = await this.systemMessage(agent);
      const opened = await this.sessionFor(agent, systemMessage);
      const prior = this.db
        .listMessages(agent.id)
        .filter((message) => message.id !== userMessage.id)
        .slice(-MEMORY_MESSAGE_WINDOW);
      const prompt = buildSessionPrompt({
        summary: agent.memorySummary,
        prior,
        latest: text,
        routine: input.source === "routine",
        freshSession: opened.fresh,
      });
      const response = await opened.live.session.sendAndWait({ prompt }, TURN_TIMEOUT_MS);
      const finalText = readAssistantText(response, streamed).trim() || streamed.trim() || "No response.";
      this.db.addMessage(agent.id, "assistant", finalText, turnId);
      this.db.finishTurn(turnId, "ok");
      this.finalizeCheckpoints(agent.id, turnId);
      this.sink({ agentId: agent.id, type: "done", text: finalText });
      void this.refreshMemory(agent.id).catch((error: unknown) => {
        console.error("Failed to update agent memory", error);
      });
      return finalText;
    } catch (error) {
      const message = explainCopilotError(error instanceof Error ? error.message : String(error));
      const partial = streamed.trim();
      const stored = partial ? `${partial}\n\nStopped: ${message}` : `Stopped: ${message}`;
      this.db.addMessage(agent.id, "assistant", stored, turnId);
      this.db.finishTurn(turnId, "error");
      this.finalizeCheckpoints(agent.id, turnId);
      this.sink({ agentId: agent.id, type: "error", error: message });
      throw new Error(message);
    } finally {
      this.activeTurns.delete(agent.id);
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
      tools: this.toolsFor(agent),
      getContext: () => this.context(agent.id),
      onToolStart: (toolName, preview) => {
        this.sink({ agentId: agent.id, type: "tool-start", toolName, text: preview });
      },
      onToolEnd: (toolName, ok, text) => {
        const live = text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
        this.db.addMessage(agent.id, "tool", summarizeTool(toolName, ok, live), this.activeTurns.get(agent.id) ?? null);
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
    const turnId = this.activeTurns.get(agentId) ?? null;
    return {
      agentId,
      workspaceDir,
      model: agent.model,
      turnId: turnId ?? undefined,
      browser: this.browser,
      githubPat: shellEnabled && hasSecret(secretKeys.githubPat) ? getSecret(secretKeys.githubPat) : null,
      jiraToken: hasSecret(secretKeys.jira) ? getSecret(secretKeys.jira) : null,
      jiraSite: this.db.getSetting("jira_site_url"),
      explore:
        shellEnabled && workspaceDir
          ? (question) => runCodeExplore(this.context(agentId), question)
          : undefined,
      checkpoint:
        turnId === null
          ? undefined
          : {
              capture: (file, previous) => this.checkpoints.capture(agentId, turnId, file, previous),
            },
      onPlan:
        turnId === null
          ? undefined
          : (steps) => {
              this.db.setPlan(agentId, turnId, steps);
              this.sink({ agentId, type: "plan", steps, turnId });
            },
    };
  }

  async previewContext(agentId: string): Promise<ContextView> {
    const agent = this.db.getAgent(agentId);
    if (!agent) throw new Error("Agent not found");
    const parts = await this.systemParts(agent);
    return {
      agentId,
      model: agent.model,
      toolProfile: agent.toolProfile,
      systemMessage: parts.text,
      memorySummary: agent.memorySummary,
      workspaceBrief: parts.brief,
      rules: parts.rules?.files ?? [],
      tools: this.toolsFor(agent).map((tool) => tool.name),
      chars: {
        system: parts.text.length,
        memory: agent.memorySummary.length,
        brief: parts.brief?.length ?? 0,
        rules: parts.rules?.text.length ?? 0,
      },
    };
  }

  private async systemMessage(agent: Agent): Promise<string> {
    return (await this.systemParts(agent)).text;
  }

  private async systemParts(
    agent: Agent,
  ): Promise<{ text: string; brief: string | null; rules: WorkspaceRules | null }> {
    const shellEnabled = agent.toolProfile !== "browser";
    const browserEnabled = agent.toolProfile !== "developer";
    const lines = [agent.systemPrompt, PLAN_HINT];
    let brief: string | null = null;
    let rules: WorkspaceRules | null = null;
    if (shellEnabled && agent.workspaceDir) {
      lines.push(`Workspace folder: ${agent.workspaceDir}`);
      lines.push(WORKSPACE_HINT);
      brief = await workspaceBrief(agent.workspaceDir);
      if (brief) lines.push(brief);
    }
    if (agent.workspaceDir) {
      rules = workspaceRules(agent.workspaceDir);
      if (rules.text) lines.push(rules.text);
    }
    const jiraSite = this.db.getSetting("jira_site_url");
    if (jiraSite) lines.push(`Jira site URL: ${jiraSite}`);
    if (browserEnabled) {
      lines.push(
        jiraToolsReady(jiraSite, hasSecret(secretKeys.jira))
          ? "Jira tools are available. Use them unless the user asks for the browser or a Jira tool fails. Do not print the token."
          : "Jira tools are not configured. Use the browser for Jira, or save the site and token in Settings → Jira.",
      );
    }
    if (shellEnabled && hasSecret(secretKeys.jira)) {
      lines.push("A Jira API token is available to shell_run as JIRA_API_TOKEN. Do not print it or ask the user to paste it.");
    }
    if (shellEnabled && hasSecret(secretKeys.githubPat)) {
      lines.push("A GitHub token is available to shell_run as GH_TOKEN. Do not print it.");
    }
    if (shellEnabled) {
      lines.push(
        "Deletes, git pushes, and downloads need the user's approval. Call shell_run first; it returns DELETE_CONFIRM_REQUIRED. Then ask the user in chat. Only after their latest message explicitly approves, call shell_run again with confirmed: true.",
      );
    }
    if (browserEnabled) {
      lines.push(
        "Browser tools control a headed browser on this Windows machine. This agent has its own persistent profile. Call browser_snapshot before browser_click or browser_type.",
      );
    }
    return { text: lines.join("\n\n"), brief, rules };
  }

  private toolsFor(agent: Agent) {
    const tools = toolsForAgent(agent.toolProfile);
    if (jiraToolsReady(this.db.getSetting("jira_site_url"), hasSecret(secretKeys.jira))) return tools;
    return tools.filter((tool) => !tool.name.startsWith("jira_"));
  }

  private finalizeCheckpoints(agentId: string, turnId: string): void {
    try {
      this.checkpoints.finalizeTurn(agentId, turnId);
    } catch (error) {
      console.error("Failed to finalize turn checkpoints", error);
    }
  }

  private async refreshMemory(agentId: string): Promise<void> {
    const agent = this.db.getAgent(agentId);
    if (!agent || !agent.memoryEnabled) return;
    const messages = this.db.listMessages(agent.id);
    if (messages.length <= MEMORY_MESSAGE_WINDOW) return;
    const turns = memoryTurns(messages);
    const pending = pendingMemoryTurns(turns, this.db.getMemoryTurnCount(agent.id));
    if (!pending) return;
    const startSummary = agent.memorySummary;
    const text = await completeOnce(
      AUTO_MODEL_ID,
      "You keep a short memory of an agent conversation. Reply with the memory only.",
      summaryUpdatePrompt(startSummary, pending),
    );
    const summary = clipMemorySummary(text);
    if (!summary) return;
    const current = this.db.getAgent(agent.id);
    if (!current || current.memorySummary !== startSummary) return;
    this.db.setMemorySummary(agent.id, summary, turns.length);
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


