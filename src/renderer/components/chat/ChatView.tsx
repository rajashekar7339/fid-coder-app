import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bug,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileText,
  Folder,
  GitBranch,
  Globe2,
  Keyboard,
  Loader2,
  Map as MapIcon,
  MousePointerClick,
  Network,
  PanelRight,
  ScanSearch,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  Terminal,
  Undo2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { groupToolCalls, liveTurnSettled, projectThread, userTurnAccepted, type LiveTool, type LiveTurn } from "../../../shared/chat-thread";
import { COMMANDS, commandAvailability, filterCommands, parseCommand, type CommandInfo } from "../../../shared/commands";
import {
  filterSkills,
  matchSkillInvocation,
  MAX_SKILL_CHARS,
  skillVersionLabel,
  SKILL_SOURCE_LABELS,
} from "../../../shared/skills";
import { summarizeTool } from "../../../shared/summary";
import { WORKSPACE_STARTERS, type Starter } from "../../../shared/starters";
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
import {
  formatClock,
  formatCount,
  formatDay,
  formatFullTimestamp,
  formatNextRun,
} from "../../lib/format";
import { AgentAvatar } from "../agents/AgentAvatar";
import { ApprovalCard } from "../approvals/ApprovalCard";
import { FilePeekDialog } from "./FilePeekDialog";
import { MessageContent } from "./MessageContent";
import { ProjectMapDialog } from "./ProjectMapDialog";
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
  onOpenSkills: () => void;
  onOpenHelp: () => void;
  skillSeed: string | null;
  onSkillSeedUsed: () => void;
  skillsRevision: number;
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
  use_skill: { label: "Used a skill", active: "Loading a skill", Icon: Wrench },
  skill_read: { label: "Read a skill file", active: "Reading a skill file", Icon: FileText },
  review_code: { label: "Reviewed a change", active: "Reviewing a change", Icon: ScanSearch, command: "review" },
  history_first: { label: "Read the first message", active: "Reading the first message", Icon: Clock3 },
  history_search: { label: "Searched history", active: "Searching history", Icon: ScanSearch },
  history_turn: { label: "Read an earlier turn", active: "Reading an earlier turn", Icon: FileText },
  history_context: { label: "Loaded history", active: "Loading history", Icon: FileText },
};

const COMMAND_ICONS: Record<string, LucideIcon> = {
  review: ScanSearch,
  skills: Wrench,
  help: BookOpen,
};

const STARTER_ICONS: Record<Starter["id"], LucideIcon> = {
  architecture: Network,
  flow: GitBranch,
  review: ShieldCheck,
  troubleshoot: Bug,
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

type SkillMatch = { skill: SkillInfo; task: string } | { error: string };

function skillPickerQuery(value: string): string | null {
  if (!/^\/skills(?:\s|$)/i.test(value)) return null;
  const rest = value.slice("/skills".length);
  if (!rest.startsWith(" ")) return null;
  const query = rest.trimStart();
  return /\s/.test(query) ? null : query;
}

function skillHintFor(
  draft: string,
  command: ReturnType<typeof parseCommand>,
  match: SkillMatch | null,
  state: "loading" | "ready" | "error",
): string | null {
  if (command?.command.id !== "skills") return null;
  if (draft.trim() === "/skills") return "Open the Skills library, or type /skills <skill> <task>.";
  if (state === "loading") return "Loading skills…";
  if (state === "error") return "Skills could not be loaded. Use the skill id or open Skills.";
  if (!match) return null;
  if ("error" in match) return match.error;
  const label = `${match.skill.name} · ${skillVersionLabel(match.skill.version)}`;
  return match.task
    ? `${label} · applies to this message only.`
    : `${label} · add the task for this message.`;
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
  onOpenSkills,
  onOpenHelp,
  skillSeed,
  onSkillSeedUsed,
  skillsRevision,
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
  const [savingMode, setSavingMode] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [filePeek, setFilePeek] = useState<{ path: string; line: number } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillInfo[]>([]);
  const [skillCatalogState, setSkillCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [skillPickerIndex, setSkillPickerIndex] = useState(0);
  const [skillPickerClosed, setSkillPickerClosed] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceStatus, setEnhanceStatus] = useState<string | null>(null);
  const [undoDraft, setUndoDraft] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const generation = useRef(0);
  const messageLoad = useRef(0);
  const sendLock = useRef(false);
  const enhanceLock = useRef(false);

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
  const draftCommand = parseCommand(draft);
  const pickerQuery = skillPickerQuery(draft);
  const skillMatches = filterSkills(skillCatalog, pickerQuery ?? "");
  const activeSkill = skillMatches[skillPickerIndex] ?? null;
  const skillPickerOpen = !commandsOpen && !skillPickerClosed && pickerQuery !== null;
  const skillInvocation =
    draftCommand?.command.id === "skills" && skillCatalogState === "ready"
      ? matchSkillInvocation(skillCatalog, draftCommand.args)
      : null;
  const commandQuery = draft.startsWith("/") ? draft.slice(1).split(/\s/)[0] : "";
  const commandMatches = filterCommands(commandQuery);
  const activeCommand = commandMatches[commandIndex] ?? null;
  const commandDraft = draft.startsWith("/")
    ? COMMANDS.find(
        (command) => draft.trim() === `/${command.id}` || draft.trim().startsWith(`/${command.id} `),
      )
    : null;
  const commandHint =
    !commandsOpen && commandDraft && commandDraft.id !== "skills" ? commandDraft.description : null;
  const skillHint = skillPickerOpen
    ? null
    : skillHintFor(draft, draftCommand, skillInvocation, skillCatalogState);
  const hint = !commandsOpen && !skillPickerOpen ? (skillHint ?? commandHint) : null;
  const canEnhance =
    settingsReady && signedIn && !running && !enhancing && draft.trim().length > 0;
  const enhanceHint = enhancing ? "Enhancing your draft…" : enhanceStatus;

  useEffect(() => {
    let cancelled = false;
    setSkillCatalogState("loading");
    void fid()
      .skills.list(agent.workspaceDir)
      .then((catalog) => {
        if (cancelled) return;
        setSkillCatalog(catalog.skills);
        setSkillCatalogState("ready");
      })
      .catch(() => {
        if (!cancelled) setSkillCatalogState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [agent.workspaceDir, skillsRevision]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandsOpen]);

  useEffect(() => {
    setSkillPickerIndex(0);
  }, [pickerQuery, skillPickerOpen]);

  useEffect(() => {
    setSkillPickerClosed(false);
  }, [draft]);

  useEffect(() => {
    if (!skillSeed) return;
    const seeded = parseCommand(skillSeed);
    const id = seeded?.command.id === "skills" ? seeded.args.trim() : "";
    setDraft((current) => (id ? draftWithSkill(current, id) : skillSeed));
    setCommandsOpen(false);
    setUndoDraft(null);
    setEnhanceStatus(null);
    onSkillSeedUsed();
    window.requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }, [skillSeed, onSkillSeedUsed]);

  useEffect(() => {
    if (!commandsOpen && !skillPickerOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".composer")) return;
      setCommandsOpen(false);
      setSkillPickerClosed(true);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [commandsOpen, skillPickerOpen]);

  function commandUnavailable(command: CommandInfo): string | null {
    if (command.id === "review" && !signedIn) return "Sign in to Copilot first.";
    return commandAvailability(command, agent.toolProfile, Boolean(agent.workspaceDir));
  }

  function chooseCommand(command: CommandInfo) {
    if (commandUnavailable(command)) return;
    setCommandsOpen(false);
    setCommandIndex(0);
    // A dialog command should not throw away a normal draft the user typed.
    const commandDraft = draft.trimStart().startsWith("/");
    if (command.id === "skills") {
      if (commandDraft) setDraft("");
      onOpenSkills();
      return;
    }
    if (command.ui) {
      if (commandDraft) setDraft("");
      if (command.id === "help") onOpenHelp();
      return;
    }
    setDraft(`/${command.id} `);
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  function draftWithSkill(current: string, id: string): string {
    const text = current.trim();
    if (!text) return `/skills ${id} `;
    const parsed = parseCommand(text);
    if (!parsed) return `/skills ${id} ${text}`;
    if (parsed.command.id !== "skills") return `/skills ${id} `;
    const matched =
      skillCatalogState === "ready" ? matchSkillInvocation(skillCatalog, parsed.args) : null;
    const task =
      matched && !("error" in matched)
        ? matched.task.trim()
        : parsed.args.trim().split(/\s+/).slice(1).join(" ");
    return task ? `/skills ${id} ${task}` : `/skills ${id} `;
  }

  function chooseSkill(skill: SkillInfo) {
    setCommandsOpen(false);
    setSkillPickerClosed(true);
    setDraft((current) => draftWithSkill(current, skill.id));
    window.requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function applyStarter(starter: Starter) {
    setDraft(starter.prompt);
    setCommandsOpen(false);
    setSkillPickerClosed(true);
    setUndoDraft(null);
    setEnhanceStatus(null);
    setError(null);
    window.requestAnimationFrame(() => {
      const input = composer.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(starter.prompt.length, starter.prompt.length);
    });
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

  async function enhancePrompt() {
    if (!canEnhance || enhanceLock.current) return;
    const original = draft;
    enhanceLock.current = true;
    setEnhancing(true);
    setError(null);
    setEnhanceStatus(null);
    setUndoDraft(null);
    setCommandsOpen(false);
    setSkillPickerClosed(true);
    try {
      const result = await fid().chat.enhance(agent.id, original);
      if (result.status === "enhanced") {
        setDraft(result.text);
        setUndoDraft(original);
        setEnhanceStatus("Enhanced. Review it, then send.");
        window.requestAnimationFrame(() => {
          const input = composer.current;
          if (!input) return;
          input.focus();
          input.setSelectionRange(result.text.length, result.text.length);
        });
      } else {
        setEnhanceStatus(result.reason);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      enhanceLock.current = false;
      setEnhancing(false);
    }
  }

  function undoEnhance() {
    if (undoDraft === null) return;
    setDraft(undoDraft);
    setUndoDraft(null);
    setEnhanceStatus(null);
    setError(null);
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  function send() {
    if (enhancing) return;
    const text = draft.trim();
    if (text === "/skills") {
      onOpenSkills();
      return;
    }
    if (skillCatalogState === "ready") {
      const parsed = parseCommand(text);
      if (parsed?.command.id === "skills") {
        const matched = matchSkillInvocation(skillCatalog, parsed.args);
        if ("error" in matched) {
          setError(matched.error);
          return;
        }
        if (!matched.task) {
          setError("Add the task after the skill name.");
          return;
        }
      }
    }
    sendText(text);
  }

  function sendText(raw: string) {
    const text = raw.trim();
    if (!text || running || enhancing || sendLock.current) return;
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
    setUndoDraft(null);
    setEnhanceStatus(null);
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
    if (model === agent.model || savingModel || savingMode || running) return;
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
        readOnly: agent.readOnly,
        memoryEnabled: agent.memoryEnabled,
      });
      onUpdated(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSavingModel(false);
    }
  }

  async function changeMode(readOnly: boolean) {
    if (readOnly === agent.readOnly || savingMode || savingModel || running || enhancing) return;
    setSavingMode(true);
    setError(null);
    try {
      const saved = await fid().agents.update(agent.id, {
        name: agent.name,
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        workspaceDir: agent.workspaceDir,
        model: agent.model,
        toolProfile: agent.toolProfile,
        readOnly,
        memoryEnabled: agent.memoryEnabled,
      });
      onUpdated(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSavingMode(false);
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
              {agent.toolProfile === "browser" ? (
                <>
                  <span className="slash">/</span>
                  Local browser
                </>
              ) : agent.workspaceDir ? (
                <>
                  <span className="slash">/</span>
                  Workspace
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="chat-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Open project map"
            title="Map this project's architecture"
            disabled={!agent.workspaceDir}
            onClick={() => setMapOpen(true)}
          >
            <MapIcon size={15} />
          </button>
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
                {agent.toolProfile === "browser" ? <Globe2 size={12} /> : <Folder size={12} />}
                {agent.toolProfile === "browser" ? "Local browser" : agent.workspaceDir ? "Workspace" : "No workspace"}
              </span>
              {agent.workspaceDir || agent.readOnly ? (
                <span className={agent.readOnly ? "is-read-only" : undefined}>
                  {agent.readOnly ? <ShieldCheck size={12} /> : <Terminal size={12} />}
                  {agent.readOnly ? "Ask mode" : "Agent mode"}
                </span>
              ) : null}
              {agent.nextRoutineAt ? (
                <span>
                  <Clock3 size={12} /> Next {formatNextRun(agent.nextRoutineAt)}
                </span>
              ) : null}
            </div>
            {agent.workspaceDir && signedIn ? (
              <div className="starter-block">
                <div className="starter-head">Understand this codebase</div>
                <div className="starter-grid">
                  {WORKSPACE_STARTERS.map((starter) => {
                    const Icon = STARTER_ICONS[starter.id];
                    return (
                      <button
                        key={starter.id}
                        type="button"
                        className="starter-card"
                        title={starter.hint}
                        onClick={() => applyStarter(starter)}
                      >
                        <Icon size={14} aria-hidden="true" />
                        <span>
                          <strong>{starter.label}</strong>
                          <small>{starter.hint}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
                  ? agent.workspaceDir
                    ? "Pick a starting point, or type below."
                    : "Send a message to start."
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
                  {showDay ? (
                    <div className="day-separator" title={formatFullTimestamp(stamp)}>
                      {day}
                    </div>
                  ) : null}
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
                      onOpenFile={(path, line) => setFilePeek({ path, line })}
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
          {skillPickerOpen ? (
            <div id="composer-skills" className="command-menu skill-menu" role="listbox" aria-label="Skills">
              <div className="command-menu-head">
                <span>Skills</span>
                <span>{skillCatalogState === "ready" ? `${skillMatches.length} found` : "loading"}</span>
              </div>
              {skillCatalogState === "loading" ? (
                <div className="command-empty">Loading skills…</div>
              ) : skillCatalogState === "error" ? (
                <div className="command-empty">Skills could not be loaded.</div>
              ) : skillMatches.length === 0 ? (
                <div className="command-empty">No skills match.</div>
              ) : (
                skillMatches.map((skill, index) => (
                  <button
                    key={`${skill.source}:${skill.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === skillPickerIndex}
                    className={`command-row ${index === skillPickerIndex ? "is-active" : ""}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseSkill(skill)}
                  >
                    <Wrench size={13} className="command-icon" aria-hidden="true" />
                    <span className="command-copy">
                      <span className="command-title">
                        <span className="skill-menu-name">{skill.name}</span>
                        <span className="skill-menu-id">{skill.id}</span>
                      </span>
                      <span className="command-description">{skill.description}</span>
                      <span className="command-usage">
                        {SKILL_SOURCE_LABELS[skill.source]} · {skillVersionLabel(skill.version)} ·{" "}
                        {formatCount(skill.chars)} chars
                        {skill.chars > MAX_SKILL_CHARS ? " · will be truncated" : ""}
                      </span>
                    </span>
                  </button>
                ))
              )}
              <div className="command-foot skill-menu-foot">
                <span>↑↓ move · Enter select · Esc close</span>
                <button type="button" onClick={onOpenSkills}>
                  Open Skills
                </button>
              </div>
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
            readOnly={enhancing}
            aria-label={`Message ${agent.name}`}
            aria-expanded={commandsOpen || skillPickerOpen}
            aria-controls={commandsOpen ? "composer-commands" : skillPickerOpen ? "composer-skills" : undefined}
            title="Enter to send. Shift+Enter for a new line."
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              setUndoDraft(null);
              setEnhanceStatus(null);
              setCommandsOpen(/^\/[a-z-]*$/i.test(value));
            }}
            onKeyDown={(event) => {
              if (skillPickerOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setSkillPickerIndex((index) =>
                    skillMatches.length === 0 ? 0 : (index + 1) % skillMatches.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setSkillPickerIndex((index) =>
                    skillMatches.length === 0
                      ? 0
                      : (index - 1 + skillMatches.length) % skillMatches.length,
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setSkillPickerClosed(true);
                  return;
                }
                if (
                  (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) &&
                  !event.nativeEvent.isComposing
                ) {
                  if (activeSkill) {
                    event.preventDefault();
                    chooseSkill(activeSkill);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    return;
                  }
                }
              }
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
            <div className="mode-switch" role="group" aria-label="Agent mode">
              <button
                type="button"
                className={agent.readOnly ? "is-active" : ""}
                aria-pressed={agent.readOnly}
                disabled={running || savingMode || savingModel || enhancing}
                title="Ask mode: read-only tools for this agent. No edits, clicks, or commands."
                onClick={() => void changeMode(true)}
              >
                Ask mode
              </button>
              <button
                type="button"
                className={!agent.readOnly ? "is-active" : ""}
                aria-pressed={!agent.readOnly}
                disabled={running || savingMode || savingModel || enhancing}
                title="Agent mode: full tools for this agent. Writes and actions need approval where required."
                onClick={() => void changeMode(false)}
              >
                Agent mode
              </button>
            </div>
            <ModelSelect
              value={agent.model}
              models={models}
              disabled={running || savingModel || savingMode}
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
            <button
              type="button"
              className="composer-command composer-enhance"
              aria-label="Enhance prompt"
              aria-busy={enhancing}
              title={
                enhancing
                  ? "Rewriting the draft…"
                  : "Rewrite this draft with a cheap model. Nothing is sent."
              }
              disabled={!canEnhance}
              onClick={() => void enhancePrompt()}
            >
              {enhancing ? (
                <Loader2 size={11} className="spin" aria-hidden="true" />
              ) : (
                <Sparkles size={11} aria-hidden="true" />
              )}
              {enhancing ? "Enhancing…" : "Enhance"}
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
                disabled={!settingsReady || !signedIn || !draft.trim() || enhancing}
              >
                <ArrowUp size={15} />
              </button>
            )}
          </div>
        </div>
        {enhanceHint ? (
          <div className="command-hint enhance-hint">
            <span role="status">{enhanceHint}</span>
            {!enhancing && undoDraft !== null ? (
              <button type="button" className="enhance-undo" onClick={undoEnhance}>
                <Undo2 size={11} aria-hidden="true" />
                Undo
              </button>
            ) : null}
          </div>
        ) : hint ? (
          <p className="command-hint">{hint}</p>
        ) : null}
      </form>

      {mapOpen ? (
        <ProjectMapDialog
          agent={agent}
          signedIn={signedIn}
          onClose={() => setMapOpen(false)}
          onOpenFile={(path, line) => setFilePeek({ path, line })}
        />
      ) : null}
      {filePeek ? (
        <FilePeekDialog
          agentId={agent.id}
          path={filePeek.path}
          line={filePeek.line}
          onClose={() => setFilePeek(null)}
        />
      ) : null}
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
  onOpenFile,
}: {
  agent: Agent;
  message: Message;
  streaming: boolean;
  copied: boolean;
  onCopy: (content: string) => void;
  onOpenFile: (path: string, line: number) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        <div className="user-bubble">{message.content}</div>
        <time
          className="user-time"
          dateTime={message.createdAt}
          title={formatFullTimestamp(message.createdAt)}
        >
          {formatClock(message.createdAt)}
        </time>
      </div>
    );
  }
  return (
    <article className="message">
      <div className="message-head">
        <AgentAvatar agent={agent} size="xs" />
        <span className="message-author">{agent.name}</span>
        <time
          className="message-time"
          dateTime={message.createdAt}
          title={formatFullTimestamp(message.createdAt)}
        >
          {formatClock(message.createdAt)}
        </time>
      </div>
      <div className="message-body">
        <MessageContent text={message.content} streaming={streaming} onOpenFile={onOpenFile} />
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
                <time
                  className="tool-step-time"
                  dateTime={call.createdAt}
                  title={formatFullTimestamp(call.createdAt)}
                >
                  {formatClock(call.createdAt)}
                </time>
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
