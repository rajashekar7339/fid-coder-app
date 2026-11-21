import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bug,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  Folder,
  FoldVertical,
  GitBranch,
  Globe2,
  Keyboard,
  Loader2,
  LogIn,
  Map as MapIcon,
  MousePointerClick,
  Network,
  PanelRight,
  Paperclip,
  Pencil,
  Pin,
  Save,
  ScanSearch,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  Tag,
  Terminal,
  Trash2,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { HandoffCard } from "../approvals/HandoffCard";
import { QuestionCard } from "../approvals/QuestionCard";
import { SkillSaveCard } from "../approvals/SkillSaveCard";
import type { SkillDraftInput } from "../../../shared/skill-draft";
import type { Citation } from "../../../shared/citations";
import {
  ATTACHMENT_ONLY_MESSAGE,
  addAttachments,
  attachmentKey,
  attachmentLabel,
  attachmentsForSend,
} from "../../../shared/attachments";
import {
  groupToolCalls,
  liveTurnSettled,
  projectThread,
  userTurnAccepted,
  type LiveTool,
  type LiveTurn,
} from "../../../shared/chat-thread";
import { isEditableUserMessage } from "../../../shared/message-actions";
import { COMMANDS, commandAvailability, filterCommands, parseCommand, type CommandInfo } from "../../../shared/commands";
import { changeTotals, findChangedFile } from "../../../shared/changes";
import {
  filterSkills,
  matchSkillInvocation,
  MAX_SKILL_CHARS,
  skillVersionLabel,
  SKILL_SOURCE_LABELS,
} from "../../../shared/skills";
import { summarizeTool, toolGroupSummary, workDurationLabel } from "../../../shared/summary";
import { WORKSPACE_STARTERS, type Starter } from "../../../shared/starters";
import type {
  Agent,
  ApprovalAction,
  ApprovalRequest,
  BrowserHandoffRequest,
  QuestionReply,
  QuestionRequest,
  SkillSaveRequest,
  ChangeSet,
  ChangesOpenRequest,
  ChatEvent,
  CopilotModel,
  Message,
  MessageAttachment,
  QueuedMessage,
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
import { EditedFilesCard } from "./EditedFilesCard";
import { MessageContent } from "./MessageContent";
import { ProjectMapDialog } from "./ProjectMapDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
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
  changeSets: ChangeSet[];
  attachments: MessageAttachment[];
  activeAttachment: MessageAttachment | null;
  onAttachmentsChange: (next: MessageAttachment[]) => void;
  onPinActive: () => void;
  onClearActive: () => void;
  onOpenChanges: (request: ChangesOpenRequest) => void;
  onRefreshChanges: () => Promise<void> | void;
  approval: ApprovalRequest | null;
  approvalBusy: boolean;
  approvalError: string | null;
  onApprovalDecision: (action: ApprovalAction) => void;
  handoff: BrowserHandoffRequest | null;
  handoffBusy: boolean;
  handoffError: string | null;
  onHandoffTakeover: () => void;
  onHandoffDone: () => void;
  skillSave: SkillSaveRequest | null;
  skillSaveBusy: boolean;
  skillSaveError: string | null;
  onSkillSaveDecide: (allow: boolean, draft?: SkillDraftInput) => void;
  question: QuestionRequest | null;
  questionBusy: boolean;
  questionError: string | null;
  onQuestionAnswer: (reply: QuestionReply) => void;
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
  browser_needs_you: { label: "Handed the browser back", active: "Waiting for you in the browser", Icon: LogIn },
  save_skill: { label: "Saved a skill", active: "Waiting to save a skill", Icon: Save },
  shell_run: { label: "Ran a shell command", active: "Running a command", Icon: Terminal },
  ask_user: { label: "Asked a question", active: "Waiting for an answer", Icon: CircleHelp },
  list_dir: { label: "Listed a folder", active: "Listing a folder", Icon: Folder },
  glob_files: { label: "Found files", active: "Finding files", Icon: Folder },
  search_text: { label: "Searched the code", active: "Searching the code", Icon: ScanSearch },
  table_read: { label: "Read a table", active: "Reading a table", Icon: FileText },
  file_read: { label: "Read a file", active: "Reading a file", Icon: FileText },
  read_many: { label: "Read files", active: "Reading files", Icon: FileText },
  confluence_search: { label: "Searched Confluence", active: "Searching Confluence", Icon: BookOpen },
  confluence_page: { label: "Read a Confluence page", active: "Reading a Confluence page", Icon: BookOpen },
  confluence_update_page: {
    label: "Updated a Confluence page",
    active: "Updating a Confluence page",
    Icon: BookOpen,
  },
  datadog_browser_logs: { label: "Read Datadog logs", active: "Reading Datadog logs", Icon: Activity },
  datadog_browser_error_summary: {
    label: "Grouped Datadog errors",
    active: "Grouping Datadog errors",
    Icon: Activity,
  },
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
  routine_list: { label: "Checked routines", active: "Checking routines", Icon: CalendarClock },
  routine_create: { label: "Created a routine", active: "Creating a routine", Icon: CalendarPlus },
  routine_delete: { label: "Removed a routine", active: "Removing a routine", Icon: CalendarX },
};

const COMMAND_ICONS: Record<string, LucideIcon> = {
  review: ScanSearch,
  skills: Wrench,
  routine: CalendarPlus,
  compact: FoldVertical,
  files: Folder,
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

function queuedLabel(item: QueuedMessage): string {
  const text = item.text.replace(/\s+/g, " ").trim();
  const label =
    text === ATTACHMENT_ONLY_MESSAGE && item.attachments.length > 0
      ? `${item.attachments.length} file${item.attachments.length === 1 ? "" : "s"}`
      : text;
  return label.length > 70 ? `${label.slice(0, 70)}…` : label;
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
  changeSets,
  attachments,
  activeAttachment,
  onAttachmentsChange,
  onPinActive,
  onClearActive,
  onOpenChanges,
  onRefreshChanges,
  approval,
  approvalBusy,
  approvalError,
  onApprovalDecision,
  handoff,
  handoffBusy,
  handoffError,
  onHandoffTakeover,
  onHandoffDone,
  skillSave,
  skillSaveBusy,
  skillSaveError,
  onSkillSaveDecide,
  question,
  questionBusy,
  questionError,
  onQuestionAnswer,
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [skillCatalog, setSkillCatalog] = useState<SkillInfo[]>([]);
  const [skillCatalogState, setSkillCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const [skillPickerIndex, setSkillPickerIndex] = useState(0);
  const [skillPickerClosed, setSkillPickerClosed] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [enhanceStatus, setEnhanceStatus] = useState<string | null>(null);
  const [undoDraft, setUndoDraft] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queueBusy, setQueueBusy] = useState(false);
  const [forceSending, setForceSending] = useState(false);
  const [confirmClearQueue, setConfirmClearQueue] = useState(false);
  const [editingQueued, setEditingQueued] = useState<string | null>(null);
  const [queueEditText, setQueueEditText] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [deleteMessageTarget, setDeleteMessageTarget] = useState<Message | null>(null);
  const [messageActionBusy, setMessageActionBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const commandMenu = useRef<HTMLDivElement>(null);
  const skillMenu = useRef<HTMLDivElement>(null);
  const mapButton = useRef<HTMLButtonElement>(null);
  const pinned = useRef(true);
  const generation = useRef(0);
  const messageLoad = useRef(0);
  const turnEpoch = useRef(0);
  const sendLock = useRef(false);
  const enhanceLock = useRef(false);
  const editWasPinned = useRef(false);

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

  const openFile = useCallback(
    (path: string, line: number, endLine: number | null, related: Citation[]) => {
      const change = findChangedFile(changeSets, path);
      onOpenChanges({
        path,
        line,
        endLine,
        related,
        ...(change ? { turnId: change.turnId, fileId: change.file.id } : {}),
      });
    },
    [changeSets, onOpenChanges],
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
  const hasWorkspace = Boolean(agent.workspaceDir?.trim());
  const commandMatches = filterCommands(commandQuery).filter(
    (command) => !(command.hideWithoutWorkspace && !hasWorkspace),
  );
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
  const activeKey = activeAttachment ? attachmentKey(activeAttachment) : null;
  const activePinned =
    activeKey !== null && attachments.some((attachment) => attachmentKey(attachment) === activeKey);
  const showingActive = activePinned ? null : activeAttachment;
  const allAttachments = attachmentsForSend(attachments, activeAttachment);
  const hasContent = draft.trim().length > 0 || allAttachments.length > 0;
  const queuePaused = queued.length > 0 && !running && !forceSending;
  const messageActionsLocked = running || enhancing || forceSending || messageActionBusy;
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
    setQueued([]);
    setEditingQueued(null);
    setQueueEditText("");
    let cancelled = false;
    void fid()
      .chat.queue(agent.id)
      .then((list) => {
        if (!cancelled) setQueued(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery, commandsOpen]);

  useEffect(() => {
    if (!commandsOpen) return;
    const row = commandMenu.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [commandsOpen, commandIndex, commandMatches.length, commandQuery]);

  useEffect(() => {
    setSkillPickerIndex(0);
  }, [pickerQuery, skillPickerOpen]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    const row = skillMenu.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [skillPickerOpen, skillPickerIndex, skillMatches.length, pickerQuery]);

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
    if ((command.id === "review" || command.id === "compact") && !signedIn) {
      return "Sign in to Copilot first.";
    }
    return commandAvailability(command, agent.toolProfile, hasWorkspace, agent.readOnly);
  }

  function chooseCommand(command: CommandInfo) {
    const unavailable = commandUnavailable(command);
    if (unavailable) {
      setError(unavailable);
      return;
    }
    setCommandsOpen(false);
    setCommandIndex(0);
    // A dialog command should not throw away a normal draft the user typed.
    const commandDraft = draft.trimStart().startsWith("/");
    if (command.id === "skills") {
      if (commandDraft) setDraft("");
      onOpenSkills();
      return;
    }
    if (command.id === "files") {
      if (commandDraft) setDraft("");
      onOpenChanges({});
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
        turnEpoch.current += 1;
        setRunning(true);
        updateLive((current) => {
          if (current?.userText === event.text) return current;
          return blankLive(current?.startedAt ?? Date.now(), {
            userText: event.text,
            userAttachments: current?.userAttachments,
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
      if (event.type === "queue") {
        setQueued(event.queue);
        setEditingQueued((id) =>
          id && event.queue.some((item) => item.id === id) ? id : null,
        );
      }
      if (event.type === "done" || event.type === "error") {
        if (event.type === "error" && event.aborted !== true) {
          setError(event.error);
          if (signInRequired(event.error)) onAuthRequired();
        }
        const nextLoad = ++messageLoad.current;
        const epoch = turnEpoch.current;
        void fid()
          .messages.list(agent.id)
          .then((list) => {
            if (
              generation.current !== gen ||
              nextLoad !== messageLoad.current ||
              epoch !== turnEpoch.current
            ) {
              return;
            }
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
  }, [
    projected.messages,
    projected.thinking,
    projected.pendingToolId,
    approval?.id,
    question?.id,
    handoff?.id,
    skillSave?.id,
    draft,
    changeSets,
  ]);

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

  async function attachFiles() {
    if (attaching || running || enhancing) return;
    setAttaching(true);
    setError(null);
    try {
      const result = await fid().dialog.pickFiles();
      if (result.attachments.length > 0) {
        onAttachmentsChange(addAttachments(attachments, result.attachments));
      }
      if (result.errors.length > 0) setError(result.errors.join(" "));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setAttaching(false);
    }
  }

  function removeAttachment(key: string) {
    onAttachmentsChange(attachments.filter((attachment) => attachmentKey(attachment) !== key));
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

  function outgoingText(): string | null {
    if (enhancing) return null;
    const text = draft.trim();
    const parsed = parseCommand(text);
    if (parsed?.command.id === "routine" && !parsed.args) {
      setError("Add the task and time after /routine.");
      return null;
    }
    if (text === "/skills") {
      onOpenSkills();
      return null;
    }
    if (skillCatalogState === "ready" && parsed?.command.id === "skills") {
      const matched = matchSkillInvocation(skillCatalog, parsed.args);
      if ("error" in matched) {
        setError(matched.error);
        return null;
      }
      if (!matched.task) {
        setError("Add the task after the skill name.");
        return null;
      }
    }
    return text;
  }

  function send() {
    const text = outgoingText();
    if (text !== null) sendText(text);
  }

  function sendNow() {
    const text = outgoingText();
    if (text !== null) sendText(text, { force: true });
  }

  function sendText(raw: string, options: { force?: boolean } = {}) {
    const text =
      raw.trim() || (allAttachments.length > 0 ? ATTACHMENT_ONLY_MESSAGE : "");
    if (!text || enhancing || sendLock.current) return;
    const uiCommand = COMMANDS.find((command) => command.ui && text === `/${command.id}`);
    if (uiCommand) {
      chooseCommand(uiCommand);
      return;
    }
    const command = parseCommand(text);
    const usesAttachments = command === null || command.command.id === "skills";
    const sentAttachments = usesAttachments ? allAttachments : [];
    const sentPinned = attachments;

    if (running) {
      if (options.force) void forceSendText(text, sentAttachments, usesAttachments);
      else void queueText(text, sentAttachments, usesAttachments);
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
    if (usesAttachments) onAttachmentsChange([]);
    setError(null);
    setUndoDraft(null);
    setEnhanceStatus(null);
    setRunning(true);
    updateLive(() =>
      blankLive(startedAt, { userText: text, userAttachments: sentAttachments }),
    );
    void fid()
      .chat.send(agent.id, text, sentAttachments)
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
          if (usesAttachments && sentPinned.length > 0) onAttachmentsChange(sentPinned);
        }
        const message = errorText(caught);
        if (message !== "Stopped by the user.") {
          setError(message);
          if (signInRequired(message)) onAuthRequired();
        }
      });
  }

  async function queueText(
    text: string,
    sentAttachments: MessageAttachment[],
    usesAttachments: boolean,
  ) {
    const gen = generation.current;
    const draftAtSend = draft;
    sendLock.current = true;
    setCommandsOpen(false);
    setSkillPickerClosed(true);
    setError(null);
    try {
      await fid().chat.enqueue(agent.id, text, sentAttachments);
      if (generation.current !== gen) return;
      setDraft((current) => (current === draftAtSend ? "" : current));
      if (usesAttachments) onAttachmentsChange([]);
      setUndoDraft(null);
      setEnhanceStatus(null);
      pinned.current = true;
      setShowJump(false);
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      sendLock.current = false;
    }
  }

  async function forceSendText(
    text: string,
    sentAttachments: MessageAttachment[],
    usesAttachments: boolean,
  ) {
    const gen = generation.current;
    const draftAtSend = draft;
    sendLock.current = true;
    setForceSending(true);
    setCommandsOpen(false);
    setSkillPickerClosed(true);
    setError(null);
    pinned.current = true;
    setShowJump(false);
    try {
      await fid().chat.forceSend(agent.id, text, sentAttachments);
      if (generation.current !== gen) return;
      setDraft((current) => (current === draftAtSend ? "" : current));
      if (usesAttachments) onAttachmentsChange([]);
      setUndoDraft(null);
      setEnhanceStatus(null);
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      if (generation.current === gen) setForceSending(false);
      sendLock.current = false;
    }
  }

  async function forceQueuedNow(item: QueuedMessage) {
    if (queueBusy || forceSending) return;
    const gen = generation.current;
    setQueueBusy(true);
    setForceSending(true);
    setError(null);
    try {
      await fid().chat.forceQueued(agent.id, item.id);
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      if (generation.current === gen) {
        setQueueBusy(false);
        setForceSending(false);
      }
    }
  }

  async function removeQueuedItem(id: string) {
    if (queueBusy || forceSending) return;
    const gen = generation.current;
    setQueueBusy(true);
    try {
      await fid().chat.removeQueued(agent.id, id);
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      if (generation.current === gen) setQueueBusy(false);
    }
  }

  function beginQueuedEdit(item: QueuedMessage) {
    if (queueBusy || forceSending) return;
    setEditingQueued(item.id);
    setQueueEditText(
      item.text === ATTACHMENT_ONLY_MESSAGE && item.attachments.length > 0
        ? ""
        : item.text,
    );
    setError(null);
  }

  function cancelQueuedEdit() {
    setEditingQueued(null);
    setQueueEditText("");
    window.requestAnimationFrame(() => composer.current?.focus());
  }

  async function saveQueuedEdit(item: QueuedMessage) {
    if (queueBusy || forceSending) return;
    const text = queueEditText.trim();
    if (!text && item.attachments.length === 0) {
      setError("Type a message before saving.");
      return;
    }
    const gen = generation.current;
    setQueueBusy(true);
    try {
      await fid().chat.updateQueued(agent.id, item.id, text);
      if (generation.current !== gen) return;
      setEditingQueued(null);
      setQueueEditText("");
      window.requestAnimationFrame(() => composer.current?.focus());
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      if (generation.current === gen) setQueueBusy(false);
    }
  }

  async function clearQueueNow() {
    await fid().chat.clearQueue(agent.id);
    setConfirmClearQueue(false);
  }

  function beginMessageEdit(message: Message) {
    if (!isEditableUserMessage(message) || messageActionsLocked) return;
    if (editingMessageId && editingMessageId !== message.id) return;
    editWasPinned.current = pinned.current;
    pinned.current = false;
    setEditingMessageId(message.id);
    setEditingMessageText(
      message.attachments?.length && message.content === ATTACHMENT_ONLY_MESSAGE
        ? ""
        : message.content,
    );
    setError(null);
    setCommandsOpen(false);
    setSkillPickerClosed(true);
  }

  function cancelMessageEdit() {
    if (messageActionBusy) return;
    setEditingMessageId(null);
    setEditingMessageText("");
    pinned.current = editWasPinned.current;
    if (pinned.current && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }

  async function reloadMessages(gen: number) {
    const list = await fid().messages.list(agent.id);
    if (generation.current !== gen) return;
    setMessages(list);
  }

  async function saveMessageEdit(message: Message) {
    if (messageActionsLocked || editingMessageId !== message.id) return;
    const text = editingMessageText.trim();
    if (!text && !(message.attachments?.length)) {
      setError("Type a message before saving.");
      return;
    }
    const gen = generation.current;
    setMessageActionBusy(true);
    setError(null);
    try {
      const updated = await fid().chat.editMessage(agent.id, message.id, text);
      if (generation.current !== gen) return;
      onUpdated(updated);
      setEditingMessageId(null);
      setEditingMessageText("");
      pinned.current = true;
      setRunning(true);
      await reloadMessages(gen);
      onActivity();
    } catch (caught) {
      if (generation.current === gen) setError(errorText(caught));
    } finally {
      if (generation.current === gen) setMessageActionBusy(false);
    }
  }

  async function deleteMessageNow() {
    const target = deleteMessageTarget;
    if (!target) return;
    const gen = generation.current;
    setMessageActionBusy(true);
    setError(null);
    try {
      const updated = await fid().chat.deleteMessage(agent.id, target.id);
      if (generation.current !== gen) return;
      onUpdated(updated);
      setDeleteMessageTarget(null);
      try {
        await reloadMessages(gen);
      } catch (caught) {
        if (generation.current === gen) setError(errorText(caught));
      }
      onActivity();
    } finally {
      if (generation.current === gen) setMessageActionBusy(false);
    }
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

  const empty = projected.messages.length === 0 && !projected.thinking && !approval && !question && !handoff && !skillSave;
  const items = groupToolCalls(projected.messages);
  const latestChange = changeSets[0] ?? null;
  const latestTotals = changeTotals(latestChange);
  const lastAssistantByTurn = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "message" && item.message.role === "assistant" && item.message.turnId) {
      lastAssistantByTurn.set(item.message.turnId, item.message.id);
    }
  }
  const changeByTurn = new Map(changeSets.map((change) => [change.turnId, change]));
  const changeCardFor = (message: Message) => {
    if (message.role !== "assistant" || !message.turnId) return null;
    if (lastAssistantByTurn.get(message.turnId) !== message.id) return null;
    const change = changeByTurn.get(message.turnId);
    return change ? (
      <EditedFilesCard
        key={`change-${change.turnId}`}
        change={change}
        onOpenChanges={onOpenChanges}
        onRefresh={onRefreshChanges}
      />
    ) : null;
  };
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
          {hasWorkspace ? (
            <button
              type="button"
              className="header-workspace"
              title={
                latestChange
                  ? "Browse workspace and review the latest turn"
                  : "Browse workspace files"
              }
              aria-label={
                latestChange
                  ? "Browse workspace and review the latest turn"
                  : "Browse workspace files"
              }
              onClick={() => onOpenChanges(latestChange ? { turnId: latestChange.turnId } : {})}
            >
              <Folder size={14} aria-hidden="true" />
              Workspace
              {latestChange ? (
                <span className="header-workspace-stats">
                  <span className="diff-add">+{latestTotals.additions}</span>
                  <span className="diff-remove">−{latestTotals.deletions}</span>
                </span>
              ) : null}
            </button>
          ) : null}
          <button
            ref={mapButton}
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
                      liveStartedAt={item.message.id === "live-assistant" ? live?.startedAt : undefined}
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
                      onOpenFile={openFile}
                      editing={editingMessageId === item.message.id}
                      editText={editingMessageText}
                      actionsLocked={
                        messageActionsLocked ||
                        (editingMessageId !== null && editingMessageId !== item.message.id)
                      }
                      actionBusy={messageActionBusy}
                      onEditTextChange={setEditingMessageText}
                      onBeginEdit={() => beginMessageEdit(item.message)}
                      onCancelEdit={cancelMessageEdit}
                      onSaveEdit={() => void saveMessageEdit(item.message)}
                      onDelete={() => {
                        if (!messageActionsLocked && isEditableUserMessage(item.message)) {
                          setDeleteMessageTarget(item.message);
                        }
                      }}
                    />
                  )}
                  {item.kind === "message" ? changeCardFor(item.message) : null}
                </Fragment>
              );
            })}
            {handoff ? (
              <HandoffCard
                handoff={handoff}
                busy={handoffBusy}
                error={handoffError}
                onTakeover={onHandoffTakeover}
                onDone={onHandoffDone}
              />
            ) : null}
            {skillSave ? (
              <SkillSaveCard
                request={skillSave}
                busy={skillSaveBusy}
                error={skillSaveError}
                onDecide={onSkillSaveDecide}
              />
            ) : null}
            {question ? (
              <QuestionCard
                question={question}
                busy={questionBusy}
                error={questionError}
                onAnswer={onQuestionAnswer}
              />
            ) : null}
            {approval ? (
              <ApprovalCard
                approval={approval}
                busy={approvalBusy}
                error={approvalError}
                onDecide={onApprovalDecision}
              />
            ) : null}
            {projected.pendingToolId || approval || question || handoff || skillSave ? null : projected.thinking && live ? (
              <LiveActivity agent={agent} live={live} />
            ) : null}
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
            <div
              id="composer-commands"
              ref={commandMenu}
              className="command-menu"
              role="listbox"
              aria-label="Commands"
            >
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
            <div
              id="composer-skills"
              ref={skillMenu}
              className="command-menu skill-menu"
              role="listbox"
              aria-label="Skills"
            >
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
          {queued.length > 0 ? (
            <div className="queue-panel" aria-label="Queued messages">
              <div className="queue-head">
                <span className="queue-title">
                  Queued · {queued.length}
                  {queuePaused ? <span className="queue-paused">Paused</span> : null}
                </span>
                <span className="queue-head-actions">
                  {queuePaused ? (
                    <button
                      type="button"
                      className="queue-head-button"
                      title="Send the first queued message now"
                      disabled={queueBusy || forceSending}
                      onClick={() => {
                        const next = queued[0];
                        if (next) void forceQueuedNow(next);
                      }}
                    >
                      Send next
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="queue-head-button"
                    title="Remove every queued message"
                    disabled={queueBusy || forceSending}
                    onClick={() => setConfirmClearQueue(true)}
                  >
                    Clear
                  </button>
                </span>
              </div>
              {queued.map((item, index) => {
                const label = queuedLabel(item);
                if (editingQueued === item.id) {
                  return (
                    <div className="queue-row is-editing" key={item.id}>
                      <span className="queue-row-index">#{index + 1}</span>
                      <textarea
                        className="queue-edit-input"
                        value={queueEditText}
                        rows={2}
                        autoFocus
                        aria-label={`Edit queued message ${index + 1}`}
                        onChange={(event) => setQueueEditText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelQueuedEdit();
                            return;
                          }
                          if (
                            event.key === "Enter" &&
                            !event.shiftKey &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            void saveQueuedEdit(item);
                          }
                        }}
                      />
                      <span className="queue-row-actions">
                        <button
                          type="button"
                          className="queue-row-text-button is-send"
                          disabled={queueBusy || forceSending}
                          onClick={() => void saveQueuedEdit(item)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="queue-row-text-button"
                          disabled={queueBusy || forceSending}
                          onClick={cancelQueuedEdit}
                        >
                          Cancel
                        </button>
                      </span>
                    </div>
                  );
                }
                return (
                  <div className="queue-row" key={item.id}>
                    <span className="queue-row-index">#{index + 1}</span>
                    <span className="queue-row-text" title={item.text}>
                      {item.text}
                    </span>
                    {item.attachments.length > 0 ? (
                      <span className="queue-row-meta">
                        {item.attachments.length} file{item.attachments.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <span className="queue-row-actions">
                      <button
                        type="button"
                        className="queue-row-text-button is-send"
                        aria-label={`Send queued message now: ${label}`}
                        title="Stop the current turn and send this message now"
                        disabled={queueBusy || forceSending}
                        onClick={() => void forceQueuedNow(item)}
                      >
                        Send now
                      </button>
                      <button
                        type="button"
                        className="queue-row-text-button"
                        aria-label={`Edit queued message: ${label}`}
                        title="Edit this queued message"
                        disabled={queueBusy || forceSending}
                        onClick={() => beginQueuedEdit(item)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="queue-row-text-button"
                        aria-label={`Cancel queued message: ${label}`}
                        title="Remove from the queue"
                        disabled={queueBusy || forceSending}
                        onClick={() => void removeQueuedItem(item.id)}
                      >
                        Cancel
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {attachments.length > 0 || showingActive ? (
            <div className="composer-attachments" aria-label="Attached context">
              {attachments.map((attachment) => {
                const label = attachmentLabel(attachment);
                return (
                  <span
                    className="composer-attachment"
                    key={attachmentKey(attachment)}
                    title={`${attachment.path} · pinned`}
                  >
                    {attachment.kind === "upload" ? (
                      <Paperclip size={10} aria-hidden="true" />
                    ) : (
                      <FileText size={10} aria-hidden="true" />
                    )}
                    <span className="composer-attachment-label">{label}</span>
                    <Pin
                      size={8}
                      className="composer-attachment-pinned"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="composer-attachment-remove"
                      aria-label={`Remove ${label}`}
                      onClick={() => removeAttachment(attachmentKey(attachment))}
                    >
                      <X size={9} />
                    </button>
                  </span>
                );
              })}
              {showingActive ? (
                <span
                  className="composer-attachment is-active-context"
                  title="Active in the workspace panel. Included with your next message. Ctrl+Shift+L to pin."
                >
                  <Tag size={10} aria-hidden="true" />
                  <span className="composer-attachment-label">
                    {attachmentLabel(showingActive)}
                  </span>
                  <span className="composer-attachment-active">active</span>
                  <button
                    type="button"
                    className="composer-attachment-pin"
                    aria-label={`Pin ${attachmentLabel(showingActive)} to this message`}
                    title="Pin to this message (Ctrl+Shift+L)"
                    onClick={onPinActive}
                  >
                    <Pin size={9} />
                  </button>
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    aria-label={`Clear active ${attachmentLabel(showingActive)}`}
                    title="Clear the active file"
                    onClick={onClearActive}
                  >
                    <X size={9} />
                  </button>
                </span>
              ) : null}
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
                : !signedIn
                  ? checkingSignIn
                    ? "Checking Copilot sign-in…"
                    : "Sign in to Copilot to chat"
                  : forceSending
                    ? "Sending your message now…"
                    : running
                      ? `Queue a message for ${agent.name}`
                      : `Message ${agent.name}`
            }
            disabled={!settingsReady || !signedIn}
            readOnly={enhancing || forceSending}
            aria-label={`Message ${agent.name}`}
            aria-expanded={commandsOpen || skillPickerOpen}
            aria-controls={commandsOpen ? "composer-commands" : skillPickerOpen ? "composer-skills" : undefined}
            title={
              forceSending
                ? "Stopping the current turn and sending your message."
                : running
                  ? "Enter queues this message. Ctrl+Enter stops the current turn and sends it now. Shift+Enter for a new line."
                  : "Enter to send. Shift+Enter for a new line."
            }
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
                if (running && (event.ctrlKey || event.metaKey)) sendNow();
                else send();
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
                title="Ask mode: every read-only tool, including browser navigate and snapshot. No edits, clicks, or commands."
                onClick={() => void changeMode(true)}
              >
                Ask mode
              </button>
              <button
                type="button"
                className={!agent.readOnly ? "is-active" : ""}
                aria-pressed={!agent.readOnly}
                disabled={running || savingMode || savingModel || enhancing}
                title="Agent mode: registers the full tools for the selected profile. Writes and actions need approval where required."
                onClick={() => void changeMode(false)}
              >
                Agent mode
              </button>
            </div>
            <button
              type="button"
              className="composer-command composer-attach"
              aria-label="Attach files"
              title="Attach files from this PC"
              disabled={!settingsReady || !signedIn || enhancing || attaching || forceSending}
              onClick={() => void attachFiles()}
            >
              {attaching ? (
                <Loader2 size={11} className="spin" aria-hidden="true" />
              ) : (
                <Paperclip size={11} aria-hidden="true" />
              )}
              <span className="composer-attach-label">
                {attaching ? "Attaching" : "Attach"}
              </span>
            </button>
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
            <div className="composer-actions">
              {forceSending ? (
                <button
                  type="button"
                  className="send-button is-now"
                  aria-label="Sending now"
                  aria-busy="true"
                  disabled
                >
                  <Loader2 size={13} className="spin" />
                </button>
              ) : running ? (
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
                  disabled={!settingsReady || !signedIn || !hasContent || enhancing}
                >
                  <ArrowUp size={15} />
                </button>
              )}
            </div>
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

      {confirmClearQueue ? (
        <ConfirmDialog
          title="Clear queued messages?"
          description={`Remove ${queued.length} queued message${queued.length === 1 ? "" : "s"}?`}
          confirmLabel="Clear queue"
          busyLabel="Clearing…"
          onCancel={() => setConfirmClearQueue(false)}
          onConfirm={clearQueueNow}
        />
      ) : null}

      {deleteMessageTarget ? (
        <ConfirmDialog
          title="Delete this message?"
          description={
            <>
              <strong>
                “{deleteMessageTarget.content.replace(/\s+/g, " ").trim().slice(0, 160)}”
              </strong>{" "}
              and the agent's reply will be removed. Later messages stay and may refer to
              the removed exchange. File edits and command effects already made are not
              reverted.
            </>
          }
          confirmLabel="Delete message"
          busyLabel="Deleting…"
          onCancel={() => setDeleteMessageTarget(null)}
          onConfirm={deleteMessageNow}
        />
      ) : null}

      {mapOpen ? (
        <ProjectMapDialog
          agent={agent}
          signedIn={signedIn}
          onClose={() => setMapOpen(false)}
          onOpenFile={(path, line, endLine, related) => {
            setMapOpen(false);
            mapButton.current?.focus();
            openFile(path, line, endLine, related);
          }}
        />
      ) : null}
    </main>
  );
}

function LiveActivity({ agent, live }: { agent: Agent; live: LiveTurn }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live.startedAt]);

  const duration = workDurationLabel(new Date(live.startedAt).toISOString(), null, now);
  const elapsed = duration?.replace(/^Working for /, "") ?? "";

  return (
    <div className="message live-activity">
      <div className="message-head">
        <AgentAvatar agent={agent} size="xs" />
        <span className="message-author">{agent.name}</span>
        <span className="activity-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="activity-thinking" role="status" aria-live="polite">
          Thinking
        </span>
        {elapsed ? <span className="activity-time">{elapsed}</span> : null}
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
  editing,
  editText,
  actionsLocked,
  actionBusy,
  onEditTextChange,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  liveStartedAt,
}: {
  agent: Agent;
  message: Message;
  streaming: boolean;
  liveStartedAt?: number;
  copied: boolean;
  onCopy: (content: string) => void;
  onOpenFile: (path: string, line: number, endLine: number | null, related: Citation[]) => void;
  editing: boolean;
  editText: string;
  actionsLocked: boolean;
  actionBusy: boolean;
  onEditTextChange: (text: string) => void;
  onBeginEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const editRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      const field = editRef.current;
      if (!field) return;
      field.focus();
      const scroller = field.closest(".chat-scroll");
      if (!(scroller instanceof HTMLElement)) return;
      const sticky = scroller.querySelector(".day-separator");
      const scrollerTop = scroller.getBoundingClientRect().top;
      const safeTop =
        sticky instanceof HTMLElement
          ? sticky.getBoundingClientRect().bottom + 8
          : scrollerTop + 12;
      const top = field.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, top - (safeTop - scrollerTop)) });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  if (message.role === "user") {
    const attachments = message.attachments ?? [];
    const manageable = isEditableUserMessage(message);
    const attachmentChips =
      attachments.length > 0 ? (
        <div className="user-attachments" aria-label="Attached context">
          {attachments.map((attachment) => (
            <span
              className="user-attachment"
              key={attachmentKey(attachment)}
              title={attachment.path}
            >
              {attachment.kind === "upload" ? (
                <Paperclip size={9} aria-hidden="true" />
              ) : (
                <FileText size={9} aria-hidden="true" />
              )}
              {attachmentLabel(attachment)}
            </span>
          ))}
        </div>
      ) : null;
    if (editing) {
      return (
        <div className="user-message is-editing">
          {attachmentChips}
          <textarea
            ref={editRef}
            className="user-edit-input"
            value={editText}
            rows={3}
            placeholder={
              attachments.length > 0
                ? "Add a message, or save to resend the attachments."
                : "Edit your message"
            }
            aria-label="Edit message"
            onChange={(event) => onEditTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !actionBusy) {
                event.preventDefault();
                onCancelEdit();
                return;
              }
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSaveEdit();
              }
            }}
          />
          <div className="user-edit-footer">
            <span className="user-edit-note">
              Saving removes the reply and every later message. File edits and command effects stay.
            </span>
            <div className="user-edit-actions">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={actionBusy}
                onClick={onCancelEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={actionBusy || actionsLocked || (!editText.trim() && attachments.length === 0)}
                onClick={onSaveEdit}
              >
                {actionBusy ? "Saving…" : "Save & rerun"}
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="user-message">
        {attachmentChips}
        <div className="user-bubble">{message.content}</div>
        <div className="user-meta">
          {manageable ? (
            <span className="user-actions">
              <button
                type="button"
                className="user-action"
                aria-label="Edit message"
                title={actionsLocked ? "Stop the agent to edit" : "Edit and rerun from here"}
                disabled={actionsLocked}
                onClick={onBeginEdit}
              >
                <Pencil size={10} aria-hidden="true" />
                Edit
              </button>
              <button
                type="button"
                className="user-action is-delete"
                aria-label="Delete message"
                title={
                  actionsLocked
                    ? "Stop the agent to delete"
                    : "Delete this message and its reply"
                }
                disabled={actionsLocked}
                onClick={onDelete}
              >
                <Trash2 size={10} aria-hidden="true" />
                Delete
              </button>
            </span>
          ) : null}
          <time
            className="user-time"
            dateTime={message.createdAt}
            title={formatFullTimestamp(message.createdAt)}
          >
            {formatClock(message.createdAt)}
          </time>
        </div>
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
        {message.role === "assistant" ? (
          <TurnDuration message={message} liveStartedAt={streaming ? liveStartedAt : undefined} />
        ) : null}
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

function TurnDuration({ message, liveStartedAt }: { message: Message; liveStartedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (liveStartedAt === undefined) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [liveStartedAt]);

  const startedAt =
    liveStartedAt !== undefined ? new Date(liveStartedAt).toISOString() : message.turnStartedAt;
  const endedAt = liveStartedAt !== undefined ? null : message.turnEndedAt;
  if (!startedAt || (liveStartedAt === undefined && !endedAt)) return null;
  const label = workDurationLabel(startedAt, endedAt, now);
  if (!label) return null;
  return <span className="message-duration">{label}</span>;
}

function ToolGroup({ calls, pendingId }: { calls: Message[]; pendingId: string | null }) {
  const live = calls.some((call) => call.id.startsWith("live-tool-"));
  const steps = calls.map((call) => {
    const split = splitTool(call.content);
    return {
      call,
      name: split.name,
      body: split.body,
      meta: toolMeta(split.name),
      pending: call.id === pendingId,
      failed: split.body.startsWith("failed:"),
    };
  });
  const pendingStep = steps.find((step) => step.pending);
  const summary = pendingStep
    ? `${pendingStep.meta.active}…`
    : toolGroupSummary(steps.map((step) => ({ name: step.name, label: step.meta.label })));
  const issues = steps.filter((step) => step.failed).length;

  return (
    <details className={live ? "tool-card is-live" : "tool-card"}>
      <summary>
        <span className="tool-check">
          {pendingId && live ? <Loader2 size={11} className="spin" aria-hidden="true" /> : <Wrench size={11} aria-hidden="true" />}
        </span>
        <b>{calls.length === 1 ? "1 tool step" : `${calls.length} tool steps`}</b>
        <span className="tool-summary">{summary}</span>
        {issues > 0 ? (
          <span className="tool-issues">
            {issues === 1 ? "1 issue" : `${issues} issues`}
          </span>
        ) : null}
        <ChevronDown size={12} className="tool-chevron" aria-hidden="true" />
      </summary>
      <div className="tool-steps">
        {steps.map(({ call, name, body, meta, pending, failed }) => {
          const Icon = meta.Icon;
          return (
            <details
              className={`tool-step${pending ? " is-running" : ""}${failed ? " is-failed" : ""}`}
              key={call.id}
            >
              <summary>
                {pending ? (
                  <Loader2 size={12} className="tool-step-icon spin" aria-hidden="true" />
                ) : (
                  <Icon size={12} className="tool-step-icon" aria-hidden="true" />
                )}
                <span className="tool-step-label">{pending ? meta.active : meta.label}</span>
                <code>{meta.command ? `/${meta.command}` : name}</code>
                {failed ? <span className="tool-step-state">Failed</span> : null}
                <time
                  className="tool-step-time"
                  dateTime={call.createdAt}
                  title={formatFullTimestamp(call.createdAt)}
                >
                  {formatClock(call.createdAt)}
                </time>
                <ChevronDown size={10} className="tool-step-chevron" aria-hidden="true" />
              </summary>
              {body ? <pre>{body}</pre> : null}
            </details>
          );
        })}
      </div>
    </details>
  );
}
