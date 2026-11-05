import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  Folder,
  Globe2,
  Keyboard,
  Loader2,
  MousePointerClick,
  PanelRight,
  ScanSearch,
  Slash,
  Square,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { groupToolCalls, liveTurnSettled, projectThread, userTurnAccepted, type LiveTool, type LiveTurn } from "../../../shared/chat-thread";
import { COMMANDS, commandAvailability, filterCommands, type CommandInfo } from "../../../shared/commands";
import { summarizeTool } from "../../../shared/summary";
import type {
  Agent,
  ApprovalAction,
  ApprovalRequest,
  ChatEvent,
  CopilotModel,
  Message,
  SkillInfo,
} from "../../../shared/types";
import { agentSubtitle } from "../../lib/agent-display";
import { errorText, fid } from "../../lib/fid";
import { formatClock, formatDay, formatNextRun } from "../../lib/format";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ApprovalCard } from "../approvals/ApprovalCard";
import { MessageContent } from "./MessageContent";
import { ModelSelect } from "../ui/ModelSelect";
import { TokenUsage } from "./TokenUsage";

type Props = {
  agent: Agent;
  models: CopilotModel[];
  modelsNote: string | null;
  settingsReady: boolean;
  signedIn: boolean;
  checkingSignIn: boolean;
  deskOpen: boolean;
  approval: ApprovalRequest | null;
  approvalBusy: boolean;
  approvalError: string | null;
  onApprovalDecision: (action: ApprovalAction) => void;
  onStartSignIn: () => void;
  onRetryModels: () => void;
  onToggleDesk: () => void;
  onEditAgent: () => void;
  onOpenHelp: () => void;
  onUpdated: (agent: Agent) => void;
  onActivity: () => void;
  onAuthRequired: () => void;
};

type ToolMeta = { label: string; active: string; Icon: LucideIcon; command?: string };

const TOOL_META: Record<string, ToolMeta> = {
  browser_navigate: { label: "Opened a page", active: "Opening a page", Icon: Globe2 },
  browser_snapshot: { label: "Read the page", active: "Reading the page", Icon: ScanSearch },
  browser_click: { label: "Clicked an element", active: "Clicking an element", Icon: MousePointerClick },
  browser_type: { label: "Typed into a field", active: "Typing into a field", Icon: Keyboard },
  shell_run: { label: "Ran a shell command", active: "Running a command", Icon: Terminal },
  list_dir: { label: "Listed a folder", active: "Listing a folder", Icon: Folder },
  glob_files: { label: "Found files", active: "Finding files", Icon: Folder },
  search_text: { label: "Searched the code", active: "Searching the code", Icon: ScanSearch },
  file_read: { label: "Read a file", active: "Reading a file", Icon: FileText },
  read_many: { label: "Read files", active: "Reading files", Icon: FileText },
  file_write: { label: "Wrote a file", active: "Writing a file", Icon: FileText },
  apply_patch: { label: "Patched a file", active: "Patching a file", Icon: FileText },
  git_status: { label: "Checked git status", active: "Checking git status", Icon: Terminal },
  git_diff: { label: "Read the diff", active: "Reading the diff", Icon: Terminal },
  git_log: { label: "Read the git log", active: "Reading the git log", Icon: Terminal },
  gh_pr_view: { label: "Read a pull request", active: "Reading a pull request", Icon: Terminal },
  gh_pr_diff: { label: "Read a pull request diff", active: "Reading a pull request diff", Icon: Terminal },
  explore_code: { label: "Explored the code", active: "Exploring the code", Icon: ScanSearch },
  review_code: { label: "Reviewed a change", active: "Reviewing a change", Icon: ScanSearch, command: "review" },
  history_first: { label: "Read the first message", active: "Reading the first message", Icon: Clock3 },
  history_search: { label: "Searched history", active: "Searching history", Icon: ScanSearch },
  history_turn: { label: "Read an earlier turn", active: "Reading an earlier turn", Icon: FileText },
  history_context: { label: "Loaded history", active: "Loading history", Icon: FileText },
  impact_analyze: { label: "Analyzed the release", active: "Analyzing the release", Icon: ScanSearch },
};

const COMMAND_ICONS: Record<string, LucideIcon> = {
  review: ScanSearch,
  skills: Wrench,
  help: BookOpen,
};

const liveByAgent = new Map<string, LiveTurn>();

function remember(agentId: string, live: LiveTurn | null) {
  if (live) liveByAgent.set(agentId, live);
  else liveByAgent.delete(agentId);
}

function toolMeta(name: string): ToolMeta {
  return TOOL_META[name] ?? { label: "Used a tool", active: "Using a tool", Icon: Wrench };
}

function blankLive(startedAt: number, partial: Partial<LiveTurn> = {}): LiveTurn {
  return { userText: "", assistant: "", tools: [], startedAt, ...partial };
}

function toolPreview(name: string, preview: string | undefined): string {
  const text = (preview ?? "").replace(/\s+/g, " ").trim();
  if (!text || text === "{}") return name;
  return `${name}: ${text.slice(0, 160)}`;
}

function finishLiveTool(tools: LiveTool[], name: string, ok: boolean, text: string): LiveTool[] {
  const next = tools.slice();
  let index = next.findIndex((tool) => tool.pending && tool.name === name);
  if (index < 0) index = next.findIndex((tool) => tool.pending);
  if (index < 0) return next;
  const current = next[index];
  if (!current) return next;
  next[index] = { ...current, pending: false, content: summarizeTool(name, ok, text) };
  return next;
}

function splitTool(content: string): { name: string; body: string } {
  const at = content.indexOf(": ");
  return at === -1 ? { name: content, body: "" } : { name: content.slice(0, at), body: content.slice(at + 2) };
}

function signInRequired(message: string): boolean {
  return /not signed in|no github oauth token|copilot hmac key|not authenticated/i.test(message);
}

export function ChatView({
  agent,
  models,
  modelsNote,
  settingsReady,
  signedIn,
  checkingSignIn,
  deskOpen,
  approval,
  approvalBusy,
  approvalError,
  onApprovalDecision,
  onStartSignIn,
  onRetryModels,
  onToggleDesk,
  onEditAgent,
  onOpenHelp,
  onUpdated,
  onActivity,
  onAuthRequired,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [live, setLiveState] = useState<LiveTurn | null>(() => liveByAgent.get(agent.id) ?? null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(() => liveByAgent.has(agent.id));
  const [error, setError] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillInfo[]>([]);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const generation = useRef(0);
  const messageLoad = useRef(0);
  const sendLock = useRef(false);

  const updateLive = useCallback(
    (updater: (current: LiveTurn | null) => LiveTurn | null) => {
      setLiveState((current) => {
        const next = updater(current);
        remember(agent.id, next);
        return next;
      });
    },
    [agent.id],
  );

  const projected = projectThread(messages, live, agent.id);
  const skillNames = new Map(skillCatalog.map((skill) => [skill.id, skill.name]));
  const agentSkills = agent.skillIds.map((id) => ({ id, name: skillNames.get(id) ?? id }));
  const commandQuery = draft.startsWith("/") ? draft.slice(1).split(/\s/)[0] : "";
  const commandMatches = filterCommands(commandQuery);
  const activeCommand = commandMatches[commandIndex] ?? null;
  const commandDraft = draft.startsWith("/")
    ? COMMANDS.find(
        (command) => draft.trim() === `/${command.id}` || draft.trim().startsWith(`/${command.id} `),
      )
    : null;
  const commandHint = !commandsOpen && commandDraft ? commandDraft.description : null;

  useEffect(() => {
    let cancelled = false;
    void fid()
      .skills.list(agent.workspaceDir)
      .then((catalog) => {
        if (!cancelled) setSkillCatalog(catalog.skills);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agent.workspaceDir]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandsOpen]);

  useEffect(() => {
    if (!commandsOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".composer")) return;
      setCommandsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [commandsOpen]);

  function commandUnavailable(command: CommandInfo): string | null {
    if (command.id === "review" && !signedIn) return "Sign in to Copilot first.";
    return commandAvailability(command, agent.toolProfile, Boolean(agent.workspaceDir));
  }

  function chooseCommand(command: CommandInfo) {
    if (commandUnavailable(command)) return;
    setCommandsOpen(false);
    setCommandIndex(0);
    if (command.ui) {
      setDraft("");
      if (command.id === "skills") onEditAgent();
      if (command.id === "help") onOpenHelp();
      return;
    }
    setDraft(`/${command.id} `);
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  useEffect(() => {
    const gen = ++generation.current;
    let cancelled = false;
    setError(null);
    const loadId = ++messageLoad.current;
    void fid()
      .messages.list(agent.id)
      .then(async (list) => {
        let active = false;
        try {
          active = await fid().chat.running(agent.id);
        } catch {
          active = false;
        }
        if (cancelled || generation.current !== gen || loadId !== messageLoad.current) return;
        const current = liveByAgent.get(agent.id) ?? null;
        const next = active
          ? (current ?? blankLive(Date.now()))
          : !current?.userText || liveTurnSettled(list, current)
            ? null
            : current;
        remember(agent.id, next);
        setMessages(list);
        setLiveState(next);
        setRunning(active || next !== null);
      })
      .catch((caught: unknown) => {
        if (!cancelled && generation.current === gen) setError(errorText(caught));
      });

    const id = fid().chat.onEvent((event: ChatEvent) => {
      if (event.agentId !== agent.id || generation.current !== gen) return;
      if (event.type === "user") {
        setRunning(true);
        updateLive((current) => {
          if (current?.userText === event.text) return current;
          return blankLive(current?.startedAt ?? Date.now(), {
            userText: event.text,
            assistant: current?.assistant ?? "",
            tools: current?.tools ?? [],
          });
        });
      }
      if (event.type === "text") {
        setRunning(true);
        updateLive((current) => {
          const base = current ?? blankLive(Date.now());
          return { ...base, assistant: base.assistant + event.text };
        });
      }
      if (event.type === "tool-start") {
        updateLive((current) => {
          const base = current ?? blankLive(Date.now());
          const tools = base.tools ?? [];
          return {
            ...base,
            tools: [
              ...tools,
              {
                id: `live-tool-${base.startedAt}-${tools.length}`,
                name: event.toolName,
                content: toolPreview(event.toolName, event.text),
                pending: true,
              },
            ],
          };
        });
      }
      if (event.type === "tool-end") {
        updateLive((current) => {
          if (!current) return current;
          const tools = finishLiveTool(current.tools ?? [], event.toolName, event.ok, event.text ?? "");
          return { ...current, tools };
        });
      }
      if (event.type === "usage") {
        updateLive((current) => (current ? { ...current, usage: event.usage } : current));
      }
      if (event.type === "done" || event.type === "error") {
        if (event.type === "error") {
          setError(event.error);
          if (signInRequired(event.error)) onAuthRequired();
        }
        const nextLoad = ++messageLoad.current;
        void fid()
          .messages.list(agent.id)
          .then((list) => {
            if (generation.current !== gen || nextLoad !== messageLoad.current) return;
            remember(agent.id, null);
            setMessages(list);
            setLiveState(null);
            setRunning(false);
            onActivity();
          })
          .catch((caught: unknown) => {
            if (generation.current === gen) setError(errorText(caught));
          });
      }
    });

    return () => {
      cancelled = true;
      fid().chat.offEvent(id);
    };
  }, [agent.id, onActivity, updateLive]);

  useEffect(() => {
    if (signedIn) composer.current?.focus();
  }, [agent.id, signedIn]);

  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 176)}px`;
  }, [draft]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [projected.messages, projected.thinking, projected.pendingToolId, approval?.id, draft]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const keepPinned = () => {
      if (!pinned.current) return;
      window.requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight;
      });
    };
    const observer = new ResizeObserver(keepPinned);
    observer.observe(element);
    window.addEventListener("resize", keepPinned);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepPinned);
    };
  }, []);

  function handleScroll() {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    pinned.current = atBottom;
    setShowJump((current) => (current === !atBottom ? current : !atBottom));
  }

  function send() {
    sendText(draft);
  }

  function sendText(raw: string) {
    const text = raw.trim();
    if (!text || running || sendLock.current) return;
    const uiCommand = COMMANDS.find((command) => command.ui && text === `/${command.id}`);
    if (uiCommand) {
      chooseCommand(uiCommand);
      return;
    }
    setCommandsOpen(false);
    sendLock.current = true;
    queueMicrotask(() => {
      sendLock.current = false;
    });
    const startedAt = Date.now();
    const gen = generation.current;
    pinned.current = true;
    setShowJump(false);
    setDraft("");
    setError(null);
    setRunning(true);
    updateLive(() => blankLive(startedAt, { userText: text }));
    void fid()
      .chat.send(agent.id, text)
      .catch(async (caught: unknown) => {
        if (generation.current !== gen) return;
        const loadId = ++messageLoad.current;
        let accepted = false;
        try {
          const list = await fid().messages.list(agent.id);
          if (generation.current !== gen) return;
          accepted = userTurnAccepted(list, text, startedAt);
          if (loadId === messageLoad.current) setMessages(list);
        } catch {
          accepted = false;
        }
        if (generation.current !== gen) return;
        if (!accepted) {
          remember(agent.id, null);
          setLiveState(null);
          setRunning(false);
          setDraft((current) => (current.trim() ? current : text));
        }
        const message = errorText(caught);
        setError(message);
        if (signInRequired(message)) onAuthRequired();
      });
  }

  async function changeModel(model: string) {
    if (model === agent.model || savingModel || running) return;
    setSavingModel(true);
    setError(null);
    try {
      const saved = await fid().agents.update(agent.id, {
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        workspaceDir: agent.workspaceDir,
        model,
        toolProfile: agent.toolProfile,
        memoryEnabled: agent.memoryEnabled,
        skillIds: agent.skillIds,
      });
      onUpdated(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSavingModel(false);
    }
  }

  const empty = projected.messages.length === 0 && !projected.thinking && !approval;
  const items = groupToolCalls(projected.messages);
  const status = !settingsReady
    ? "Checking"
    : running
      ? "Working"
      : signedIn
        ? "Ready"
        : "Sign in";
  let lastDay = "";

  return (
    <main className="chat-pane">
      <header className="chat-header">
        <div className="chat-identity">
          <AgentAvatar agent={agent} size="sm" />
          <div className="chat-title">
            <div className="chat-title-line">
              <h1>{agent.name}</h1>
              <span
                className={`status-pill ${
                  !settingsReady || running ? "is-working" : signedIn ? "is-ready" : "is-warning"
                }`}
              >
                <span />
                {status}
              </span>
            </div>
            <div className="chat-sub">
              {agentSubtitle(agent)}
              <span className="slash">/</span>
              Local browser
            </div>
          </div>
        </div>
        <div className="chat-actions">
          <button
            type="button"
            className={`icon-button ${deskOpen ? "is-active" : ""}`}
            aria-label={deskOpen ? "Hide agent desk" : "Show agent desk"}
            onClick={onToggleDesk}
          >
            <PanelRight size={15} />
          </button>
        </div>
      </header>

      {agentSkills.length > 0 ? (
        <div className="chat-skillbar" aria-label="Active skills">
          <BookOpen size={11} aria-hidden="true" />
          <span className="chat-skillbar-label">Skills</span>
          {agentSkills.map((skill) => (
            <span key={skill.id} className="chat-skill">
              {skill.name}
            </span>
          ))}
        </div>
      ) : null}

      {settingsReady && !signedIn ? (
        <div className="sign-in-banner">
          <span>{checkingSignIn ? "Checking Copilot sign-in…" : "Sign in to Copilot before messaging this agent."}</span>
          <button type="button" onClick={onStartSignIn} disabled={checkingSignIn}>
            {checkingSignIn ? "Checking…" : "Sign in"}
          </button>
        </div>
      ) : null}

      <div ref={scroller} className="chat-scroll" onScroll={handleScroll}>
        {empty ? (
          <div className="chat-empty">
            <AgentAvatar agent={agent} size="lg" />
            <h2>{agent.name}</h2>
            <p>{agentSubtitle(agent)}</p>
            <div className="empty-chips">
              <span>
                <Globe2 size={12} /> Local browser
              </span>
              {agent.workspaceDir ? (
                <span>
                  <Folder size={12} /> Workspace
                </span>
              ) : null}
              {agent.nextRoutineAt ? (
                <span>
                  <Clock3 size={12} /> Next {formatNextRun(agent.nextRoutineAt)}
                </span>
              ) : null}
            </div>
            {COMMANDS.some((command) => !commandUnavailable(command)) ? (
              <div className="empty-commands">
                {COMMANDS.filter((command) => !commandUnavailable(command)).map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className="empty-command"
                    onClick={() => chooseCommand(command)}
                  >
                    /{command.id}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="empty-hint">
              {!settingsReady
                ? "Checking Copilot…"
                : signedIn
                  ? "Send a message to start."
                  : "Sign in to Copilot, then send a message."}
            </p>
          </div>
        ) : (
          <div className="thread" role="log" aria-label={`Conversation with ${agent.name}`}>
            {items.map((item) => {
              const stamp =
                item.kind === "message" ? item.message.createdAt : item.calls[0]?.createdAt ?? "";
              const day = formatDay(stamp);
              const showDay = Boolean(day && day !== lastDay);
              if (day) lastDay = day;
              return (
                <Fragment key={item.kind === "message" ? item.message.id : item.id}>
                  {showDay ? <div className="day-separator">{day}</div> : null}
                  {item.kind === "tools" ? (
                    <ToolGroup calls={item.calls} pendingId={projected.pendingToolId} />
                  ) : (
                    <MessageRow
                      agent={agent}
                      message={item.message}
                      streaming={projected.streaming && item.message.id === "live-assistant"}
                      copied={copiedId === item.message.id}
                      onCopy={(content) => {
                        void navigator.clipboard.writeText(content).then(() => {
                          setCopiedId(item.message.id);
                          window.setTimeout(
                            () => setCopiedId((current) => (current === item.message.id ? null : current)),
                            1200,
                          );
                        });
                      }}
                    />
                  )}
                </Fragment>
              );
            })}
            {approval ? (
              <ApprovalCard
                approval={approval}
                busy={approvalBusy}
                error={approvalError}
                onDecide={onApprovalDecision}
              />
            ) : null}
            {projected.pendingToolId || approval ? null : projected.thinking ? <TypingRow agent={agent} /> : null}
          </div>
        )}
      </div>

      {showJump ? (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            const element = scroller.current;
            if (element) element.scrollTop = element.scrollHeight;
          }}
        >
          <ArrowDown size={12} />
          Jump to latest
        </button>
      ) : null}

      {error ? (
        <p className="chat-error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="composer-dock"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="composer">
          {commandsOpen ? (
            <div id="composer-commands" className="command-menu" role="listbox" aria-label="Commands">
              <div className="command-menu-head">
                <span>Commands</span>
                <span>type / to filter</span>
              </div>
              {commandMatches.length === 0 ? (
                <div className="command-empty">No commands match.</div>
              ) : (
                commandMatches.map((command, index) => {
                  const unavailable = commandUnavailable(command);
                  const Icon = COMMAND_ICONS[command.id] ?? Wrench;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      role="option"
                      aria-selected={index === commandIndex}
                      className={`command-row ${index === commandIndex ? "is-active" : ""} ${unavailable ? "is-disabled" : ""}`}
                      disabled={Boolean(unavailable)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseCommand(command)}
                    >
                      <Icon size={13} className="command-icon" aria-hidden="true" />
                      <span className="command-copy">
                        <span className="command-title">
                          <span className="command-name">/{command.id}</span>
                          <span className="command-label">{command.label}</span>
                        </span>
                        <span className="command-description">{unavailable ?? command.description}</span>
                        {!unavailable ? <span className="command-usage">{command.usage}</span> : null}
                      </span>
                    </button>
                  );
                })
              )}
              <div className="command-foot">↑↓ move · Enter select · Esc close</div>
            </div>
          ) : null}
          <textarea
            ref={composer}
            rows={1}
            className="composer-input"
            value={draft}
            placeholder={
              !settingsReady
                ? "Checking Copilot…"
                : signedIn
                  ? `Message ${agent.name}`
                  : checkingSignIn
                    ? "Checking Copilot sign-in…"
                    : "Sign in to Copilot to chat"
            }
            disabled={!settingsReady || !signedIn}
            aria-label={`Message ${agent.name}`}
            aria-expanded={commandsOpen}
            aria-controls={commandsOpen ? "composer-commands" : undefined}
            title="Enter to send. Shift+Enter for a new line."
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              setCommandsOpen(/^\/[a-z-]*$/i.test(value));
            }}
            onKeyDown={(event) => {
              if (commandsOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCommandIndex((index) =>
                    commandMatches.length === 0 ? 0 : (index + 1) % commandMatches.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandIndex((index) =>
                    commandMatches.length === 0
                      ? 0
                      : (index - 1 + commandMatches.length) % commandMatches.length,
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandsOpen(false);
                  return;
                }
                if (
                  (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) &&
                  !event.nativeEvent.isComposing &&
                  activeCommand
                ) {
                  event.preventDefault();
                  chooseCommand(activeCommand);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-bottom">
            <ModelSelect
              value={agent.model}
              models={models}
              disabled={running || savingModel}
              className="model-picker-compact"
              onChange={(model) => void changeModel(model)}
            />
            <button
              type="button"
              className="composer-command"
              aria-label="Show commands"
              aria-expanded={commandsOpen}
              aria-controls="composer-commands"
              title="Show commands (type /)"
              onClick={() => {
                setCommandsOpen((open) => !open);
                window.requestAnimationFrame(() => composer.current?.focus());
              }}
            >
              <Slash size={11} aria-hidden="true" />
              Commands
            </button>
            {agent.nextRoutineAt ? (
              <span className="composer-context">
                <Clock3 size={10} aria-hidden="true" />
                Next {formatNextRun(agent.nextRoutineAt)}
              </span>
            ) : null}
            {modelsNote ? (
              <button type="button" className="model-warning" title={modelsNote} onClick={onRetryModels}>
                Model list unavailable · Retry
              </button>
            ) : null}
            {running ? (
              <button
                type="button"
                className="send-button is-stop"
                aria-label="Stop generating"
                onClick={() => {
                  void fid()
                    .chat.abort(agent.id)
                    .catch((caught: unknown) => setError(errorText(caught)));
                }}
              >
                <Square size={11} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                aria-label="Send message"
                disabled={!settingsReady || !signedIn || !draft.trim()}
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
        {commandHint ? <p className="command-hint">{commandHint}</p> : null}
      </form>
    </main>
  );
}

function TypingRow({ agent }: { agent: Agent }) {
  return (
    <div className="message">
      <div className="message-head">
        <AgentAvatar agent={agent} size="xs" />
        <span className="message-author">{agent.name}</span>
        <span className="typing-label">Thinking</span>
      </div>
      <div className="typing-dots" aria-label="Thinking">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}

function MessageRow({
  agent,
  message,
  streaming,
  copied,
  onCopy,
}: {
  agent: Agent;
  message: Message;
  streaming: boolean;
  copied: boolean;
  onCopy: (content: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        <div className="user-bubble">{message.content}</div>
        <span className="user-time">{formatClock(message.createdAt)}</span>
      </div>
    );
  }
  return (
    <article className="message">
      <div className="message-head">
        <AgentAvatar agent={agent} size="xs" />
        <span className="message-author">{agent.name}</span>
        <span className="message-time">{formatClock(message.createdAt)}</span>
      </div>
      <div className="message-body">
        <MessageContent text={message.content} streaming={streaming} />
        {streaming ? <span className="stream-caret" /> : null}
      </div>
      <div className="message-foot">
        {message.usage ? <TokenUsage usage={message.usage} live={streaming} /> : null}
        {!streaming ? (
          <button type="button" className="message-copy" onClick={() => onCopy(message.content)}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ToolGroup({ calls, pendingId }: { calls: Message[]; pendingId: string | null }) {
  const live = calls.some((call) => call.id.startsWith("live-tool-"));
  const names = calls.map((call) => {
    const split = splitTool(call.content);
    const meta = toolMeta(split.name);
    return call.id === pendingId ? meta.active : meta.label;
  });
  const summary = pendingId ? names.slice(-2).join(" · ") : names.slice(0, 2).join(" · ");

  return (
    <details className={live ? "tool-card is-live" : "tool-card"}>
      <summary>
        <span className="tool-check">
          {pendingId && live ? <Loader2 size={11} className="spin" aria-hidden="true" /> : <Wrench size={11} aria-hidden="true" />}
        </span>
        <b>{calls.length === 1 ? "1 tool step" : `${calls.length} tool steps`}</b>
        <span className="tool-summary">{summary}</span>
        <ChevronDown size={12} className="tool-chevron" aria-hidden="true" />
      </summary>
      <div className="tool-steps">
        {calls.map((call) => {
          const split = splitTool(call.content);
          const meta = toolMeta(split.name);
          const pending = call.id === pendingId;
          const Icon = meta.Icon;
          return (
            <details className={pending ? "tool-step is-running" : "tool-step"} key={call.id}>
              <summary>
                {pending ? (
                  <Loader2 size={12} className="tool-step-icon spin" aria-hidden="true" />
                ) : (
                  <Icon size={12} className="tool-step-icon" aria-hidden="true" />
                )}
                <span className="tool-step-label">{pending ? meta.active : meta.label}</span>
                <code>{meta.command ? `/${meta.command}` : split.name}</code>
                <span className="tool-step-time">{formatClock(call.createdAt)}</span>
                <ChevronDown size={10} className="tool-step-chevron" aria-hidden="true" />
              </summary>
              {split.body ? <pre>{split.body}</pre> : null}
            </details>
          );
        })}
      </div>
    </details>
  );
}
