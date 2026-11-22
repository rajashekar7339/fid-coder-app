import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CircleHelp, LogIn, Plus, Save, ShieldAlert, X } from "lucide-react";
import { COPILOT_USAGE_REFRESH_MS, type CopilotUsageView } from "../shared/copilot-usage";
import { addAttachments } from "../shared/attachments";
import type { SkillDraftInput } from "../shared/skill-draft";
import type {
  Agent,
  AgentPlacement,
  ApprovalAction,
  ApprovalRequest,
  BrowserHandoffRequest,
  QuestionReply,
  QuestionRequest,
  SkillSaveRequest,
  ChangeSet,
  ChangesOpenRequest,
  CopilotModel,
  MessageAttachment,
  Routine,
  SettingsView,
} from "../shared/types";
import { AgentDesk } from "./components/desk/AgentDesk";
import { ChangesPanel } from "./components/desk/ChangesPanel";
import { AgentDialog } from "./components/agents/AgentDialog";
import { BrandMark } from "./components/ui/BrandMark";
import { ChatView } from "./components/chat/ChatView";
import { ConfirmDialog } from "./components/ui/ConfirmDialog";
import { HelpDialog } from "./components/help/HelpDialog";
import { InboxDialog } from "./components/routines/InboxDialog";
import { RoutinesDialog } from "./components/routines/RoutinesDialog";
import { SkillsDialog } from "./components/skills/SkillsDialog";
import { SettingsDialog, type SettingsSection, type SignInNote } from "./components/settings/SettingsDialog";
import { Sidebar, type CopilotPresence } from "./components/sidebar/Sidebar";
import { inboxBadgeCount, type InboxItem, type InboxView } from "../shared/inbox";
import { errorText, fid, hasFid } from "./lib/fid";
import {
  clampWorkspaceWidth,
  maxWorkspaceWidth,
  MIN_WORKSPACE_WIDTH,
  WORKSPACE_WIDTH_KEY,
} from "./lib/layout";

type CardNotice = { id: string; text: string } | null;

function noticeText(notice: CardNotice, id: string | null | undefined): string | null {
  return notice && notice.id === id ? notice.text : null;
}

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; agentId: string }
  | { kind: "help" }
  | { kind: "routines" }
  | { kind: "inbox" }
  | { kind: "skills" }
  | { kind: "settings"; section: SettingsSection };

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
const RUNNING_POLL_MS = 1500;
const DESK_BREAKPOINT = "(min-width: 1181px)";

export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [inbox, setInbox] = useState<InboxView>({ items: [], unread: 0 });
  const [runningAgentIds, setRunningAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [usage, setUsage] = useState<CopilotUsageView | null>(null);
  const [usageMessage, setUsageMessage] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deskOpen, setDeskOpen] = useState(() => window.innerWidth >= 1181);
  const [changesOpen, setChangesOpen] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState<number | null>(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_WIDTH_KEY);
      const value = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(value) ? clampWorkspaceWidth(value, window.innerWidth) : null;
    } catch {
      return null;
    }
  });
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const workspaceMaxWidth = maxWorkspaceWidth(viewportWidth);
  const workspaceWidthNow =
    workspaceWidth === null ? null : clampWorkspaceWidth(workspaceWidth, viewportWidth);
  const [changesRequest, setChangesRequest] = useState<ChangesOpenRequest | null>(null);
  const [changeSets, setChangeSets] = useState<ChangeSet[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingSignIn, setCheckingSignIn] = useState(false);
  const [signInNote, setSignInNote] = useState<SignInNote | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [decidingApprovalId, setDecidingApprovalId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<CardNotice>(null);
  const [pendingQuestions, setPendingQuestions] = useState<QuestionRequest[]>([]);
  const [answeringQuestionId, setAnsweringQuestionId] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<CardNotice>(null);
  const [pendingHandoffs, setPendingHandoffs] = useState<BrowserHandoffRequest[]>([]);
  const [handoffBusyId, setHandoffBusyId] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<CardNotice>(null);
  const [pendingSkillSaves, setPendingSkillSaves] = useState<SkillSaveRequest[]>([]);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [skillSaveError, setSkillSaveError] = useState<CardNotice>(null);
  const [skillSeed, setSkillSeed] = useState<string | null>(null);
  const [skillsRevision, setSkillsRevision] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [activeAttachment, setActiveAttachment] = useState<MessageAttachment | null>(null);

  const modelsRequest = useRef(0);
  const routinesRequest = useRef(0);
  const usageRequest = useRef(0);
  const changesRequestId = useRef(0);
  const changesReturnFocus = useRef<HTMLElement | null>(null);
  const signInWatch = useRef(0);
  const signInTimer = useRef<number | null>(null);

  const refreshAgents = useCallback(async (): Promise<Agent[]> => {
    const list = await fid().agents.list();
    setAgents(list);
    return list;
  }, []);

  const refreshModels = useCallback(async () => {
    const request = ++modelsRequest.current;
    setModelsLoading(true);
    try {
      const list = await fid().models.list();
      if (modelsRequest.current !== request) return;
      setModels(list);
      setModelsNote(null);
    } catch (caught) {
      if (modelsRequest.current !== request) return;
      setModelsNote(errorText(caught));
    } finally {
      if (modelsRequest.current === request) setModelsLoading(false);
    }
  }, []);

  const refreshSettings = useCallback(async (refreshAuth = false): Promise<SettingsView> => {
    const next = await fid().settings.get(refreshAuth ? { refreshAuth: true } : undefined);
    setSettings(next);
    return next;
  }, []);

  const refreshUsage = useCallback(async (force = false): Promise<void> => {
    const request = ++usageRequest.current;
    setUsageLoading(true);
    try {
      const result = await fid().settings.usage(force ? { force: true } : undefined);
      if (usageRequest.current !== request) return;
      setUsage(result.usage);
      setUsageMessage(result.message);
    } catch (caught) {
      if (usageRequest.current !== request) return;
      setUsage(null);
      setUsageMessage(errorText(caught));
    } finally {
      if (usageRequest.current === request) setUsageLoading(false);
    }
  }, []);

  const refreshRoutines = useCallback(async (): Promise<Routine[]> => {
    if (!agentId) {
      setRoutines([]);
      return [];
    }
    const request = ++routinesRequest.current;
    const list = await fid().routines.list(agentId);
    if (request === routinesRequest.current) setRoutines(list);
    return list;
  }, [agentId]);

  const refreshInbox = useCallback(async () => {
    if (!hasFid() || typeof fid().inbox?.list !== "function") return;
    setInbox(await fid().inbox.list());
  }, []);

  useEffect(() => {
    if (!hasFid() || typeof fid().inbox?.onChanged !== "function" || typeof fid().app?.onOpenAgent !== "function") return;
    void refreshInbox().catch((caught: unknown) => setLoadError(errorText(caught)));
    const changed = fid().inbox.onChanged(() => {
      void refreshInbox().catch(() => undefined);
    });
    const opened = fid().app.onOpenAgent((id) => {
      setAgentId(id);
      setDialog(null);
    });
    return () => {
      fid().inbox.offChanged(changed);
      fid().app.offOpenAgent(opened);
    };
  }, [refreshInbox]);

  const openInboxItem = useCallback(async (item: InboxItem) => {
    if (item.kind !== "approval") setInbox(await fid().inbox.read(item.id));
    setAgentId(item.agentId);
    setDialog(null);
  }, []);

  const snoozeInboxItem = useCallback(async (item: InboxItem) => {
    setInbox(await fid().inbox.snooze(item.id));
  }, []);

  const dismissInboxItem = useCallback(async (item: InboxItem) => {
    setInbox(await fid().inbox.read(item.id));
  }, []);

  const openInboxAgent = useCallback((nextAgentId: string) => {
    setAgentId(nextAgentId);
    setDialog(null);
  }, []);

  const openAgentRoutines = useCallback((nextAgentId: string) => {
    setAgentId(nextAgentId);
    setDialog({ kind: "routines" });
  }, []);

  const refreshChanges = useCallback(
    async (id: string | null = agentId): Promise<void> => {
      if (!id) {
        changesRequestId.current += 1;
        setChangeSets([]);
        setChangesLoading(false);
        setChangesError(null);
        return;
      }
      const request = ++changesRequestId.current;
      setChangesLoading(true);
      try {
        const list = await fid().changes.list(id, 30);
        if (request !== changesRequestId.current) return;
        setChangeSets(list);
        setChangesError(null);
      } catch (caught) {
        if (request !== changesRequestId.current) return;
        setChangesError(errorText(caught));
      } finally {
        if (request === changesRequestId.current) setChangesLoading(false);
      }
    },
    [agentId],
  );

  const openChanges = useCallback(
    (request: ChangesOpenRequest = {}) => {
      changesReturnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDeskOpen(false);
      setChatCollapsed(false);
      setChangesRequest(request);
      setChangesOpen(true);
      void refreshChanges().catch(() => undefined);
    },
    [refreshChanges],
  );

  const closeChanges = useCallback(() => {
    setChangesOpen(false);
    setChatCollapsed(false);
    setChangesRequest(null);
    const target = changesReturnFocus.current;
    changesReturnFocus.current = null;
    window.requestAnimationFrame(() => {
      if (target?.isConnected) target.focus();
    });
  }, []);

  const toggleDesk = useCallback(() => {
    closeChanges();
    setDeskOpen((open) => !open);
  }, [closeChanges]);

  const clearActiveAttachment = useCallback(() => setActiveAttachment(null), []);

  const pinActive = useCallback(() => {
    if (!activeAttachment) return;
    setPendingAttachments(addAttachments(pendingAttachments, [activeAttachment]));
  }, [activeAttachment, pendingAttachments]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "l" || !activeAttachment) return;
      event.preventDefault();
      pinActive();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeAttachment, pinActive]);

  const stopSignInWatch = useCallback(() => {
    signInWatch.current += 1;
    if (signInTimer.current !== null) {
      window.clearInterval(signInTimer.current);
      signInTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopSignInWatch(), [stopSignInWatch]);

  useEffect(() => {
    if (!hasFid()) return;
    const id = fid().chat.onEvent((event) => {
      if (event.type === "user") {
        setRunningAgentIds((current) => {
          if (current.has(event.agentId)) return current;
          const next = new Set(current);
          next.add(event.agentId);
          return next;
        });
      }
      if (event.type === "done" || event.type === "error") {
        setRunningAgentIds((current) => {
          if (!current.has(event.agentId)) return current;
          const next = new Set(current);
          next.delete(event.agentId);
          return next;
        });
      }
      if (event.type === "approval-request") {
        setApprovalError(null);
        setPendingApprovals((current) => {
          if (current.some((item) => item.id === event.approval.id)) return current;
          return [...current, event.approval].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        });
      }
      if (event.type === "approval-resolved") {
        setDecidingApprovalId(null);
        setPendingApprovals((current) => current.filter((item) => item.id !== event.approvalId));
      }
      if (event.type === "question-request") {
        setQuestionError(null);
        setPendingQuestions((current) => {
          if (current.some((item) => item.id === event.question.id)) return current;
          return [...current, event.question].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        });
      }
      if (event.type === "question-resolved") {
        setAnsweringQuestionId(null);
        setPendingQuestions((current) => current.filter((item) => item.id !== event.questionId));
      }
      if (event.type === "handoff-request") {
        setHandoffError(null);
        setPendingHandoffs((current) => {
          if (current.some((item) => item.id === event.handoff.id)) return current;
          return [...current, event.handoff].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        });
      }
      if (event.type === "handoff-updated") {
        setPendingHandoffs((current) =>
          current.map((item) => (item.id === event.handoff.id ? event.handoff : item)),
        );
      }
      if (event.type === "handoff-resolved") {
        setHandoffBusyId(null);
        setPendingHandoffs((current) => current.filter((item) => item.id !== event.handoffId));
      }
      if (event.type === "skill-save-request") {
        setSkillSaveError(null);
        setPendingSkillSaves((current) => {
          if (current.some((item) => item.id === event.request.id)) return current;
          return [...current, event.request].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        });
      }
      if (event.type === "skill-save-resolved") {
        setSavingSkillId(null);
        setPendingSkillSaves((current) => current.filter((item) => item.id !== event.requestId));
        if (event.saved) setSkillsRevision((current) => current + 1);
      }
    });
    void fid()
      .approvals.pending()
      .then((list) => setPendingApprovals(list))
      .catch(() => undefined);
    void fid()
      .questions.pending()
      .then((list) => setPendingQuestions(list))
      .catch(() => undefined);
    void fid()
      .handoffs.pending()
      .then((list) => setPendingHandoffs(list))
      .catch(() => undefined);
    void fid()
      .skillSaves.pending()
      .then((list) => setPendingSkillSaves(list))
      .catch(() => undefined);
    return () => fid().chat.offEvent(id);
  }, []);

  useEffect(() => {
    if (!hasFid() || typeof fid().chat.runningAll !== "function") return;
    let cancelled = false;
    const refresh = () => {
      void fid()
        .chat.runningAll()
        .then((ids) => {
          if (cancelled) return;
          setRunningAgentIds((current) => {
            if (current.size === ids.length && ids.every((id) => current.has(id))) return current;
            return new Set(ids);
          });
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, RUNNING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (workspaceWidthNow === null) window.localStorage.removeItem(WORKSPACE_WIDTH_KEY);
        else window.localStorage.setItem(WORKSPACE_WIDTH_KEY, String(workspaceWidthNow));
      } catch {
        // A blocked or private storage must not break the layout.
      }
    }, 200);
    return () => window.clearTimeout(timer);
  }, [workspaceWidthNow]);

  function updateWorkspaceWidth(next: number | null) {
    setWorkspaceWidth(next === null ? null : clampWorkspaceWidth(next, viewportWidth));
  }

  const watchSignIn = useCallback(() => {
    stopSignInWatch();
    const watchId = signInWatch.current;
    const started = Date.now();
    setCheckingSignIn(true);
    const tick = async () => {
      if (signInWatch.current !== watchId) return;
      try {
        const next = await refreshSettings(true);
        if (signInWatch.current !== watchId) return;
        if (next.signedIn) {
          stopSignInWatch();
          setCheckingSignIn(false);
          setSignInNote({ tone: "ok", text: "Signed in." });
          return;
        }
        if (Date.now() - started >= SIGN_IN_TIMEOUT_MS) {
          stopSignInWatch();
          setCheckingSignIn(false);
          setSignInNote({
            tone: "error",
            text: "Sign-in was not detected. Finish the browser page and try again.",
          });
        }
      } catch (caught) {
        if (signInWatch.current !== watchId) return;
        stopSignInWatch();
        setCheckingSignIn(false);
        setSignInNote({ tone: "error", text: errorText(caught) });
      }
    };
    void tick();
    signInTimer.current = window.setInterval(() => {
      void tick();
    }, SIGN_IN_POLL_MS);
  }, [refreshSettings, stopSignInWatch]);

  const startSignIn = useCallback(async () => {
    setSignInNote({ tone: "progress", text: "Opening Copilot sign-in…" });
    setCheckingSignIn(true);
    try {
      const result = await fid().settings.startCopilotLogin();
      if (!result.ok) {
        stopSignInWatch();
        setCheckingSignIn(false);
        setSignInNote({ tone: "error", text: result.message });
        return;
      }
      setSignInNote({
        tone: "progress",
        text: "Finish sign-in in the browser. Checking until Copilot reports your account.",
      });
      watchSignIn();
    } catch (caught) {
      stopSignInWatch();
      setCheckingSignIn(false);
      setSignInNote({ tone: "error", text: errorText(caught) });
    }
  }, [stopSignInWatch, watchSignIn]);

  const signOutCopilot = useCallback(async (): Promise<SettingsView> => {
    const signOut = fid().settings.signOut;
    if (typeof signOut !== "function") {
      throw new Error("Restart Fid Coder, then sign out again.");
    }
    const next = await signOut();
    stopSignInWatch();
    setCheckingSignIn(false);
    setSignInNote(null);
    setSettings(next);
    return next;
  }, [stopSignInWatch]);

  const onActivity = useCallback(() => {
    void refreshAgents().catch(() => undefined);
    void refreshRoutines().catch(() => undefined);
    void refreshChanges().catch(() => undefined);
  }, [refreshAgents, refreshChanges, refreshRoutines]);

  const refreshRoutinesForDialog = useCallback(async (): Promise<Routine[]> => {
    const list = await refreshRoutines();
    void refreshAgents().catch(() => undefined);
    return list;
  }, [refreshRoutines, refreshAgents]);

  const refreshAfterAuthFailure = useCallback(() => {
    void refreshSettings(true).catch(() => undefined);
  }, [refreshSettings]);

  async function toggleRoutine(routine: Routine) {
    await fid().routines.update(routine.id, { enabled: !routine.enabled });
    await Promise.all([refreshRoutines(), refreshAgents()]);
  }

  async function takeoverHandoff(requestId?: string) {
    const handoffId = requestId ?? handoff?.id;
    const current = pendingHandoffs.find((item) => item.id === handoffId);
    if (!handoffId || !current || handoffBusyId || current.takenOver) return;
    setHandoffBusyId(handoffId);
    setHandoffError(null);
    setPendingHandoffs((items) =>
      items.map((item) => (item.id === handoffId ? { ...item, takenOver: true } : item)),
    );
    try {
      const open = await fid().handoffs.takeover(handoffId);
      if (!open) setHandoffError({ id: handoffId, text: "The browser window is not open yet." });
    } catch (caught) {
      setHandoffError({ id: handoffId, text: errorText(caught) });
    } finally {
      setHandoffBusyId((busy) => (busy === handoffId ? null : busy));
    }
  }

  async function completeHandoff(requestId?: string) {
    const handoffId = requestId ?? handoff?.id;
    if (!handoffId || handoffBusyId) return;
    setHandoffBusyId(handoffId);
    setHandoffError(null);
    try {
      const accepted = await fid().handoffs.done(handoffId);
      if (!accepted) setHandoffError({ id: handoffId, text: "That handoff already closed." });
      else setPendingHandoffs((items) => items.filter((item) => item.id !== handoffId));
    } catch (caught) {
      setHandoffError({ id: handoffId, text: errorText(caught) });
    } finally {
      setHandoffBusyId((busy) => (busy === handoffId ? null : busy));
    }
  }

  async function decideSkillSave(allow: boolean, draft?: SkillDraftInput, requestId?: string) {
    const skillId = requestId ?? skillSave?.id;
    if (!skillId || savingSkillId) return;
    setSavingSkillId(skillId);
    setSkillSaveError(null);
    try {
      const accepted = await fid().skillSaves.decide(skillId, allow, draft);
      if (!accepted) setSkillSaveError({ id: skillId, text: "That skill already closed." });
      else setPendingSkillSaves((items) => items.filter((item) => item.id !== skillId));
    } catch (caught) {
      setSkillSaveError({ id: skillId, text: errorText(caught) });
    } finally {
      setSavingSkillId((busy) => (busy === skillId ? null : busy));
    }
  }

  async function answerQuestion(reply: QuestionReply, requestId?: string) {
    const questionId = requestId ?? question?.id;
    if (!questionId || answeringQuestionId) return;
    setAnsweringQuestionId(questionId);
    setQuestionError(null);
    try {
      const accepted = await fid().questions.answer(questionId, reply);
      if (!accepted) setQuestionError({ id: questionId, text: "That question already closed." });
      setPendingQuestions((items) => items.filter((item) => item.id !== questionId));
    } catch (caught) {
      setQuestionError({ id: questionId, text: errorText(caught) });
    } finally {
      setAnsweringQuestionId((busy) => (busy === questionId ? null : busy));
    }
  }

  async function decideApproval(action: ApprovalAction, requestId?: string) {
    const approvalId = requestId ?? approval?.id;
    if (!approvalId || decidingApprovalId) return;
    setDecidingApprovalId(approvalId);
    setApprovalError(null);
    try {
      await fid().approvals.decide(approvalId, action);
      setPendingApprovals((items) => items.filter((item) => item.id !== approvalId));
    } catch (caught) {
      setApprovalError({ id: approvalId, text: errorText(caught) });
    } finally {
      setDecidingApprovalId((busy) => (busy === approvalId ? null : busy));
    }
  }

  useEffect(() => {
    if (!hasFid()) {
      setLoadError("Open Fid Coder from the desktop app. This page has no connection to the local agent engine.");
      return;
    }
    void refreshAgents()
      .then((list) => {
        setAgentId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((error: unknown) => setLoadError(errorText(error)));
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
    void refreshModels();
  }, [refreshAgents, refreshModels, refreshSettings]);

  useEffect(() => {
    setRoutines([]);
    void refreshRoutines().catch((error: unknown) => setLoadError(errorText(error)));
  }, [agentId, refreshRoutines]);

  useEffect(() => {
    setChangeSets([]);
    setChangesError(null);
    setChangesOpen(false);
    setChatCollapsed(false);
    setChangesRequest(null);
    setPendingAttachments([]);
    setActiveAttachment(null);
    if (agentId) void refreshChanges(agentId);
  }, [agentId, refreshChanges]);

  useEffect(() => {
    if (!settings?.signedIn) return;
    void refreshModels();
  }, [settings?.signedIn, refreshModels]);

  useEffect(() => {
    if (!settings?.signedIn) {
      usageRequest.current += 1;
      setUsage(null);
      setUsageMessage(null);
      setUsageLoading(false);
      return;
    }
    void refreshUsage();
  }, [settings?.signedIn, refreshUsage]);

  useEffect(() => {
    if (!settings?.signedIn) return;
    const timer = window.setInterval(() => {
      void refreshUsage();
    }, COPILOT_USAGE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [settings?.signedIn, refreshUsage]);

  useEffect(() => {
    if (dialog?.kind !== "settings") return;
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
    void refreshUsage();
  }, [dialog, refreshSettings, refreshUsage]);

  useEffect(() => {
    function onFocus() {
      void refreshSettings().catch(() => undefined);
      void refreshAgents().catch(() => undefined);
      if (agentId) void refreshRoutines().catch(() => undefined);
      if (settings?.signedIn) void refreshUsage();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [agentId, settings?.signedIn, refreshAgents, refreshRoutines, refreshSettings, refreshUsage]);

  useEffect(() => {
    const query = window.matchMedia(DESK_BREAKPOINT);
    const sync = () => setDeskOpen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function onHelpKey(event: KeyboardEvent) {
      if (event.key !== "F1") return;
      event.preventDefault();
      setDialog((current) => {
        if (current?.kind === "help") return null;
        return current ?? { kind: "help" };
      });
    }
    window.addEventListener("keydown", onHelpKey);
    return () => window.removeEventListener("keydown", onHelpKey);
  }, []);

  useEffect(() => {
    if (!agentId || agents.length === 0) return;
    if (!agents.some((agent) => agent.id === agentId)) setAgentId(agents[0]?.id ?? null);
  }, [agents, agentId]);

  function openCreate() {
    setDialog({ kind: "create" });
  }

  function openEdit(agent: Agent) {
    setDialog({ kind: "edit", agentId: agent.id });
  }

  function openSettings(section: SettingsSection = "copilot") {
    setDialog({ kind: "settings", section });
  }

  function openRoutines() {
    if (agentId) setDialog({ kind: "routines" });
  }

  function openHelp() {
    setDialog({ kind: "help" });
  }

  function openSkills() {
    setDialog({ kind: "skills" });
  }

  const bumpSkills = useCallback(() => setSkillsRevision((value) => value + 1), []);
  const consumeSkillSeed = useCallback(() => setSkillSeed(null), []);

  function useSkill(id: string) {
    setDialog(null);
    setSkillSeed(`/skills ${id} `);
  }

  function startSignInFromChat() {
    openSettings("copilot");
    void startSignIn();
  }

  async function placeAgent(agent: Agent, placement: AgentPlacement) {
    try {
      const updated = await fid().agents.place(agent.id, placement);
      setAgents((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (caught) {
      setLoadError(errorText(caught));
    }
  }

  async function deleteAgent(agent: Agent) {
    await fid().agents.delete(agent.id);
    setPendingDelete(null);
    setDialog(null);
    try {
      const list = await refreshAgents();
      if (agentId === agent.id) setAgentId(list[0]?.id ?? null);
    } catch (caught) {
      setLoadError(errorText(caught));
    }
  }

  const selected = agents.find((agent) => agent.id === agentId) ?? null;
  const selectedModelReady = selected
    ? selected.provider === "deepseek"
      ? Boolean(settings?.hasDeepseekKey)
      : Boolean(settings?.signedIn)
    : false;
  const approval = pendingApprovals.find((item) => item.agentId === agentId) ?? null;
  const question = pendingQuestions.find((item) => item.agentId === agentId) ?? null;
  const handoff = pendingHandoffs.find((item) => item.agentId === agentId) ?? null;
  const skillSave = pendingSkillSaves.find((item) => item.agentId === agentId) ?? null;
  const otherApprovals = pendingApprovals.filter((item) => item.agentId !== agentId);
  const otherQuestions = pendingQuestions.filter((item) => item.agentId !== agentId);
  const otherHandoffs = pendingHandoffs.filter((item) => item.agentId !== agentId);
  const otherSkillSaves = pendingSkillSaves.filter((item) => item.agentId !== agentId);
  const otherApproval = otherApprovals[0] ?? null;
  const otherQuestion = otherQuestions[0] ?? null;
  const otherHandoff = otherHandoffs[0] ?? null;
  const otherSkillSave = otherSkillSaves[0] ?? null;
  const inboxBadge = inboxBadgeCount(
    inbox.unread,
    pendingQuestions.length + pendingHandoffs.length + pendingSkillSaves.length,
  );
  const editing = dialog?.kind === "edit" ? (agents.find((agent) => agent.id === dialog.agentId) ?? null) : null;
  const copilotPresence: CopilotPresence = settings?.signedIn
    ? "ready"
    : checkingSignIn
      ? "checking"
      : settings === null
        ? "unknown"
        : "out";
  const showChanges = Boolean(selected && changesOpen);
  const showDesk = Boolean(selected && deskOpen && !showChanges);
  const shellStyle =
    workspaceWidthNow === null
      ? undefined
      : ({ "--workspace-width": `${workspaceWidthNow}px` } as CSSProperties);

  if (loadError && agents.length === 0 && !hasFid()) {
    return <FullMessage title="Fid Coder" body={loadError} />;
  }

  return (
    <>
      <div
        className={`app-shell ${showDesk ? "has-desk" : ""} ${showChanges ? "has-changes" : ""} ${
          showChanges && chatCollapsed ? "is-chat-collapsed" : ""
        }`}
        style={shellStyle}
      >
        <Sidebar
          agents={agents}
          selectedId={agentId}
          copilotPresence={copilotPresence}
          loginName={settings?.loginName ?? null}
          signedIn={settings?.signedIn ?? false}
          usage={usage}
          onSelect={setAgentId}
          onCreate={openCreate}
          onEdit={openEdit}
          onPlace={(agent, placement) => void placeAgent(agent, placement)}
          onDelete={setPendingDelete}
          onSettings={() => openSettings("copilot")}
          onSkills={openSkills}
          onHelp={openHelp}
          inboxCount={inboxBadge}
          onInbox={() => setDialog({ kind: "inbox" })}
          runningAgentIds={runningAgentIds}
        />

        <div className="center-column">
          {loadError ? (
            <div className="app-error" role="alert">
              <span>{loadError}</span>
              <button type="button" aria-label="Dismiss error" onClick={() => setLoadError(null)}>
                <X size={12} />
              </button>
            </div>
          ) : null}
          {otherHandoff ? (
            <button
              type="button"
              className="approval-notice"
              onClick={() => setAgentId(otherHandoff.agentId)}
            >
              <LogIn size={13} aria-hidden="true" />
              <span>
                Needs you in the browser for {otherHandoff.agentName}
                {otherHandoffs.length > 1 ? ` +${otherHandoffs.length - 1}` : ""}
              </span>
              <b>Open</b>
            </button>
          ) : null}
          {otherSkillSave ? (
            <button
              type="button"
              className="approval-notice"
              onClick={() => setAgentId(otherSkillSave.agentId)}
            >
              <Save size={13} aria-hidden="true" />
              <span>
                Save a skill for {otherSkillSave.agentName}
                {otherSkillSaves.length > 1 ? ` +${otherSkillSaves.length - 1}` : ""}
              </span>
              <b>Open</b>
            </button>
          ) : null}
          {otherQuestion ? (
            <button
              type="button"
              className="approval-notice"
              onClick={() => setAgentId(otherQuestion.agentId)}
            >
              <CircleHelp size={13} aria-hidden="true" />
              <span>
                Answer needed for {otherQuestion.agentName}
                {otherQuestions.length > 1 ? ` +${otherQuestions.length - 1}` : ""}
              </span>
              <b>Open</b>
            </button>
          ) : null}
          {otherApproval ? (
            <button
              type="button"
              className="approval-notice"
              onClick={() => setAgentId(otherApproval.agentId)}
            >
              <ShieldAlert size={13} aria-hidden="true" />
              <span>
                Approval needed for {otherApproval.agentName}
                {otherApprovals.length > 1 ? ` +${otherApprovals.length - 1}` : ""}
              </span>
              <b>Open</b>
            </button>
          ) : null}
          {selected ? (
            <ChatView
              key={selected.id}
              agent={selected}
              models={models}
              modelsNote={modelsNote}
              settingsReady={settings !== null}
              modelReady={selectedModelReady}
              checkingSignIn={checkingSignIn}
              deskOpen={showDesk}
              changeSets={changeSets}
              attachments={pendingAttachments}
              activeAttachment={activeAttachment}
              onAttachmentsChange={setPendingAttachments}
              onPinActive={pinActive}
              onClearActive={clearActiveAttachment}
              onOpenChanges={openChanges}
              onRefreshChanges={() => refreshChanges()}
              approval={approval}
              approvalBusy={approval !== null && decidingApprovalId === approval.id}
              approvalError={noticeText(approvalError, approval?.id)}
              onApprovalDecision={(action) => void decideApproval(action)}
              handoff={handoff}
              handoffBusy={handoff !== null && handoffBusyId === handoff.id}
              handoffError={noticeText(handoffError, handoff?.id)}
              onHandoffTakeover={() => void takeoverHandoff()}
              onHandoffDone={() => void completeHandoff()}
              skillSave={skillSave}
              skillSaveBusy={skillSave !== null && savingSkillId === skillSave.id}
              skillSaveError={noticeText(skillSaveError, skillSave?.id)}
              onSkillSaveDecide={(allow, draft) => void decideSkillSave(allow, draft)}
              question={question}
              questionBusy={question !== null && answeringQuestionId === question.id}
              questionError={noticeText(questionError, question?.id)}
              onQuestionAnswer={(reply) => void answerQuestion(reply)}
              onStartSignIn={startSignInFromChat}
              onOpenModelSettings={() =>
                openSettings(selected.provider === "deepseek" ? "deepseek" : "copilot")
              }
              onRetryModels={() => void refreshModels()}
              onToggleDesk={toggleDesk}
              onOpenSkills={openSkills}
              onOpenHelp={openHelp}
              skillSeed={skillSeed}
              onSkillSeedUsed={consumeSkillSeed}
              skillsRevision={skillsRevision}
              onUpdated={(agent) => {
                setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
              }}
              onActivity={onActivity}
              onAuthRequired={refreshAfterAuthFailure}
            />
          ) : (
            <EmptyApp onCreate={openCreate} />
          )}
        </div>

        {showDesk && selected ? (
          <AgentDesk
            agent={selected}
            routines={routines.filter((routine) => routine.agentId === selected.id)}
            latestChange={changeSets[0] ?? null}
            changesLoading={changesLoading}
            changesError={changesError}
            onOpenChanges={openChanges}
            onClose={() => setDeskOpen(false)}
            onEdit={() => openEdit(selected)}
            onOpenRoutines={openRoutines}
            onToggleRoutine={toggleRoutine}
          />
        ) : null}

        {showChanges ? (
          <button
            type="button"
            className="changes-scrim"
            tabIndex={-1}
            aria-label="Close changes"
            onClick={closeChanges}
          />
        ) : null}
        {showChanges && selected ? (
          <ChangesPanel
            agent={selected}
            changeSets={changeSets}
            loading={changesLoading}
            error={changesError}
            request={changesRequest}
            chatCollapsed={chatCollapsed}
            workspaceWidth={workspaceWidthNow}
            minWorkspaceWidth={MIN_WORKSPACE_WIDTH}
            maxWorkspaceWidth={workspaceMaxWidth}
            onWorkspaceWidth={updateWorkspaceWidth}
            onToggleChat={() => setChatCollapsed((collapsed) => !collapsed)}
            onActiveContext={setActiveAttachment}
            onClose={closeChanges}
            onRefresh={() => refreshChanges()}
          />
        ) : null}
      </div>

      {dialog?.kind === "create" ? (
        <AgentDialog
          agent={null}
          models={models}
          modelsNote={modelsNote}
          modelsLoading={modelsLoading}
          onRetryModels={() => void refreshModels()}
          onClose={() => setDialog(null)}
          onSaved={(agent) => {
            setDialog(null);
            setAgents((current) => [
              ...current.filter((item) => item.id !== agent.id),
              agent,
            ]);
            setAgentId(agent.id);
            void refreshAgents().catch((error: unknown) => setLoadError(errorText(error)));
          }}
        />
      ) : null}

      {editing ? (
        <AgentDialog
          agent={editing}
          models={models}
          modelsNote={modelsNote}
          modelsLoading={modelsLoading}
          onRetryModels={() => void refreshModels()}
          onClose={() => setDialog(null)}
          onSaved={(agent) => {
            setDialog(null);
            setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
          }}
          onMemoryCleared={(agent) => {
            setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
          }}
        />
      ) : null}

      {dialog?.kind === "routines" && selected ? (
        <RoutinesDialog
          agent={selected}
          routines={routines.filter((routine) => routine.agentId === selected.id)}
          onClose={() => setDialog(null)}
          onRefresh={refreshRoutinesForDialog}
        />
      ) : null}

      {dialog?.kind === "inbox" ? (
        <InboxDialog
          view={inbox}
          approvals={pendingApprovals}
          questions={pendingQuestions}
          handoffs={pendingHandoffs}
          skillSaves={pendingSkillSaves}
          approvalBusyId={decidingApprovalId}
          questionBusyId={answeringQuestionId}
          handoffBusyId={handoffBusyId}
          skillSaveBusyId={savingSkillId}
          approvalError={approvalError}
          questionError={questionError}
          handoffError={handoffError}
          skillSaveError={skillSaveError}
          onClose={() => setDialog(null)}
          onOpen={(item) => void openInboxItem(item).catch((caught: unknown) => setLoadError(errorText(caught)))}
          onSnooze={(item) => void snoozeInboxItem(item).catch((caught: unknown) => setLoadError(errorText(caught)))}
          onDismiss={(item) => void dismissInboxItem(item).catch((caught: unknown) => setLoadError(errorText(caught)))}
          onOpenAgent={openInboxAgent}
          onDecideApproval={(id, action) => void decideApproval(action, id)}
          onAnswerQuestion={(id, reply) => void answerQuestion(reply, id)}
          onTakeoverHandoff={(id) => void takeoverHandoff(id)}
          onCompleteHandoff={(id) => void completeHandoff(id)}
          onDecideSkillSave={(id, allow, draft) => void decideSkillSave(allow, draft, id)}
          onOpenRoutines={openAgentRoutines}
        />
      ) : null}

      {dialog?.kind === "help" ? <HelpDialog onClose={() => setDialog(null)} /> : null}

      {dialog?.kind === "skills" ? (
        <SkillsDialog
          workspaceDir={selected?.workspaceDir ?? null}
          hasAgent={Boolean(selected)}
          onClose={() => setDialog(null)}
          onUse={useSkill}
          onChanged={bumpSkills}
        />
      ) : null}

      {dialog?.kind === "settings" ? (
        <SettingsDialog
          agents={agents}
          settings={settings}
          usage={usage}
          usageMessage={usageMessage}
          usageLoading={usageLoading}
          onRefreshUsage={refreshUsage}
          section={dialog.section}
          checkingSignIn={checkingSignIn}
          signInNote={signInNote}
          onSectionChange={(section) => setDialog({ kind: "settings", section })}
          onClose={() => setDialog(null)}
          onStartSignIn={() => void startSignIn()}
          onSignOut={signOutCopilot}
          onSaved={() => {
            void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
          }}
          onRefresh={refreshSettings}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete agent"
          description={
            <>
              <strong>{pendingDelete.name}</strong> and everything stored with it — conversation, routines, and local
              browser profile — will be removed from this machine.
            </>
          }
          confirmLabel="Delete agent"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteAgent(pendingDelete)}
        />
      ) : null}

    </>
  );
}

function EmptyApp({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-app">
      <BrandMark />
      <h1>No agents yet</h1>
      <p>Create a local teammate with its own instructions, browser profile, and routines.</p>
      <button type="button" className="btn btn-primary" onClick={onCreate}>
        <Plus size={14} />
        New agent
      </button>
    </div>
  );
}

function FullMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="full-message">
      <BrandMark />
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
