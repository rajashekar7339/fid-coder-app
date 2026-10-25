import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Agent, CopilotModel, Routine, SettingsView } from "../shared/types";
import { AgentDesk } from "./components/AgentDesk";
import { AgentDialog } from "./components/AgentDialog";
import { BrandMark } from "./components/BrandMark";
import { ChatView } from "./components/ChatView";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { RoutinesDialog } from "./components/RoutinesDialog";
import { SettingsDialog, type SettingsSection, type SignInNote } from "./components/SettingsDialog";
import { Sidebar, type CopilotPresence } from "./components/Sidebar";
import { errorText, fid, hasFid } from "./fid";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; agentId: string }
  | { kind: "routines" }
  | { kind: "settings"; section: SettingsSection };

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;
const DESK_BREAKPOINT = "(min-width: 1181px)";

export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deskOpen, setDeskOpen] = useState(() => window.innerWidth >= 1181);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingSignIn, setCheckingSignIn] = useState(false);
  const [signInNote, setSignInNote] = useState<SignInNote | null>(null);

  const modelsRequest = useRef(0);
  const routinesRequest = useRef(0);
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

  const stopSignInWatch = useCallback(() => {
    signInWatch.current += 1;
    if (signInTimer.current !== null) {
      window.clearInterval(signInTimer.current);
      signInTimer.current = null;
    }
  }, []);

  useEffect(() => () => stopSignInWatch(), [stopSignInWatch]);

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
  }, [refreshAgents, refreshRoutines]);

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
    if (!settings?.signedIn) return;
    void refreshModels();
  }, [settings?.signedIn, refreshModels]);

  useEffect(() => {
    if (dialog?.kind !== "settings") return;
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
  }, [dialog, refreshSettings]);

  useEffect(() => {
    function onFocus() {
      void refreshSettings().catch(() => undefined);
      void refreshAgents().catch(() => undefined);
      if (agentId) void refreshRoutines().catch(() => undefined);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [agentId, refreshAgents, refreshRoutines, refreshSettings]);

  useEffect(() => {
    const query = window.matchMedia(DESK_BREAKPOINT);
    const sync = () => setDeskOpen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
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

  function startSignInFromChat() {
    openSettings("copilot");
    void startSignIn();
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
  const editing = dialog?.kind === "edit" ? (agents.find((agent) => agent.id === dialog.agentId) ?? null) : null;
  const copilotPresence: CopilotPresence = settings?.signedIn
    ? "ready"
    : checkingSignIn
      ? "checking"
      : settings === null
        ? "unknown"
        : "out";
  const showDesk = Boolean(selected && deskOpen);

  if (loadError && agents.length === 0 && !hasFid()) {
    return <FullMessage title="Fid Coder" body={loadError} />;
  }

  return (
    <>
      <div className={`app-shell ${showDesk ? "has-desk" : ""}`}>
        <Sidebar
          agents={agents}
          selectedId={agentId}
          copilotPresence={copilotPresence}
          loginName={settings?.loginName ?? null}
          signedIn={settings?.signedIn ?? false}
          onSelect={setAgentId}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={setPendingDelete}
          onSettings={() => openSettings("copilot")}
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
          {selected ? (
            <ChatView
              key={selected.id}
              agent={selected}
              models={models}
              modelsNote={modelsNote}
              settingsReady={settings !== null}
              signedIn={settings?.signedIn ?? false}
              checkingSignIn={checkingSignIn}
              deskOpen={deskOpen}
              onStartSignIn={startSignInFromChat}
              onRetryModels={() => void refreshModels()}
              onToggleDesk={() => setDeskOpen((open) => !open)}
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
            routines={routines}
            onClose={() => setDeskOpen(false)}
            onEdit={() => openEdit(selected)}
            onOpenRoutines={openRoutines}
            onToggleRoutine={toggleRoutine}
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
        />
      ) : null}

      {dialog?.kind === "routines" && selected ? (
        <RoutinesDialog
          agent={selected}
          routines={routines}
          onClose={() => setDialog(null)}
          onRefresh={refreshRoutinesForDialog}
        />
      ) : null}

      {dialog?.kind === "settings" ? (
        <SettingsDialog
          settings={settings}
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
