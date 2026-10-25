import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, CopilotModel, SettingsView } from "../shared/types";
import { AgentForm } from "./components/AgentForm";
import { ChatView } from "./components/ChatView";
import { CreateAgentDialog } from "./components/CreateAgentDialog";
import { Dialog } from "./components/Dialog";
import { SettingsView as SettingsScreen, type SettingsSection } from "./components/SettingsView";
import { Sidebar, type CopilotPresence } from "./components/Sidebar";
import { errorText, fid } from "./fid";

type SignInNote = { tone: "progress" | "ok" | "error"; text: string };

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;

export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<CopilotModel[]>([]);
  const [modelsNote, setModelsNote] = useState<string | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const modelsRequest = useRef(0);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgentId, setEditAgentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("copilot");
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingSignIn, setCheckingSignIn] = useState(false);
  const [signInNote, setSignInNote] = useState<SignInNote | null>(null);
  const signInWatch = useRef(0);
  const signInTimer = useRef<number | null>(null);
  const offeredCreate = useRef(false);

  const refreshAgents = useCallback(async () => {
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

  const refreshSettings = useCallback(async () => {
    const next = await fid().settings.get();
    setSettings(next);
    return next;
  }, []);

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
        const next = await refreshSettings();
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
            text: "Sign-in was not detected. Finish the browser page and try Sign in again.",
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

  const signOutCopilot = useCallback(async () => {
    const confirmed = window.confirm("Sign out of GitHub Copilot on this computer? The next chat has to sign in again.");
    if (!confirmed) return null;
    const signOutFn = fid().settings.signOut;
    if (typeof signOutFn !== "function") {
      throw new Error("Restart Fid Coder, then sign out again.");
    }
    const next = await signOutFn();
    stopSignInWatch();
    setCheckingSignIn(false);
    setSignInNote(null);
    setSettings(next);
    return next;
  }, [stopSignInWatch]);

  function openSettings(section: SettingsSection = "copilot") {
    setCreateOpen(false);
    setEditAgentId(null);
    setSettingsSection(section);
    setSettingsOpen(true);
  }

  function openCreate() {
    setSettingsOpen(false);
    setEditAgentId(null);
    setCreateOpen(true);
  }

  function openEdit(id: string) {
    setCreateOpen(false);
    setSettingsOpen(false);
    setEditAgentId(id);
  }

  useEffect(() => {
    if (!window.fid) {
      setLoadError("Open Fid Coder from the desktop app. The page has no connection to the local agent engine.");
      return;
    }
    void refreshAgents()
      .then((list) => {
        if (list[0]) setAgentId(list[0].id);
        else if (!offeredCreate.current) {
          offeredCreate.current = true;
          setCreateOpen(true);
        }
      })
      .catch((error: unknown) => setLoadError(errorText(error)));
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
    void refreshModels();
  }, [refreshAgents, refreshModels, refreshSettings]);

  useEffect(() => {
    if (!settings?.signedIn) return;
    void refreshModels();
  }, [settings?.signedIn, refreshModels]);

  useEffect(() => {
    if (!settingsOpen) return;
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
  }, [settingsOpen, refreshSettings]);

  useEffect(() => {
    const onFocus = () => {
      void refreshSettings().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSettings]);

  async function deleteAgent(agent: Agent) {
    if (!window.confirm(`Delete ${agent.name}? This removes its chat, routines, and browser profile.`)) return;
    try {
      await fid().agents.delete(agent.id);
      const list = await refreshAgents();
      if (editAgentId === agent.id) setEditAgentId(null);
      if (agentId !== agent.id) return;
      if (list[0]) {
        setAgentId(list[0].id);
        return;
      }
      setAgentId(null);
      setCreateOpen(true);
    } catch (caught) {
      setLoadError(errorText(caught));
    }
  }

  const selected = agents.find((agent) => agent.id === agentId) ?? null;
  const editing = agents.find((agent) => agent.id === editAgentId) ?? null;
  const copilotPresence: CopilotPresence = settings?.signedIn ? "ready" : checkingSignIn ? "checking" : settings === null ? "unknown" : "out";

  if (loadError && agents.length === 0 && !window.fid) {
    return <FullMessage title="Fid Coder" body={loadError} />;
  }

  return (
    <div className="flex h-full">
      <Sidebar
        agents={agents}
        models={models}
        selectedId={agentId}
        copilotPresence={copilotPresence}
        loginName={settings?.loginName ?? null}
        signedIn={settings?.signedIn ?? false}
        onSelect={(id) => setAgentId(id)}
        onCreate={openCreate}
        onEdit={(agent) => openEdit(agent.id)}
        onDelete={(agent) => void deleteAgent(agent)}
        onSettings={() => openSettings("copilot")}
        onSignIn={() => {
          openSettings("copilot");
          void startSignIn();
        }}
        onSignOut={() => {
          void signOutCopilot().catch((caught: unknown) => {
            setSignInNote({ tone: "error", text: errorText(caught) });
            openSettings("copilot");
          });
        }}
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        {loadError ? <p className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[13px] text-destructive">{loadError}</p> : null}
        {selected ? (
          <ChatView
            key={selected.id}
            agent={selected}
            models={models}
            modelsNote={modelsNote}
            signedIn={settings?.signedIn ?? false}
            checkingSignIn={checkingSignIn}
            onOpenSettings={() => openSettings("copilot")}
            onRetryModels={() => void refreshModels()}
            onUpdated={(agent) => {
              setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
            }}
          />
        ) : (
          <FullMessage title="No agents yet" body="Create an agent to start a conversation." />
        )}
      </main>
      {createOpen ? (
        <CreateAgentDialog
          onCancel={() => setCreateOpen(false)}
          onCreated={(agent) => {
            void refreshAgents().then(() => setAgentId(agent.id));
            setCreateOpen(false);
          }}
        />
      ) : null}
      {editing ? (
        <Dialog title="Edit agent" width="max-w-2xl" onClose={() => setEditAgentId(null)}>
          <AgentForm
            agent={editing}
            models={models}
            modelsNote={modelsNote}
            modelsLoading={modelsLoading}
            onRetryModels={() => void refreshModels()}
            onCancel={() => setEditAgentId(null)}
            onSaved={(agent) => {
              setAgents((current) => current.map((item) => (item.id === agent.id ? agent : item)));
              void refreshAgents();
              setAgentId(agent.id);
              setEditAgentId(null);
            }}
          />
        </Dialog>
      ) : null}
      {settingsOpen ? (
        <SettingsScreen
          settings={settings}
          section={settingsSection}
          checkingSignIn={checkingSignIn}
          signInNote={signInNote}
          onSectionChange={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
          onStartSignIn={() => void startSignIn()}
          onSignOut={signOutCopilot}
          onSaved={() => {
            void refreshSettings();
          }}
        />
      ) : null}
    </div>
  );
}

function FullMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center p-8 text-center">
      <div>
        <h1 className="text-[20px] font-medium">{title}</h1>
        <p className="mt-2 max-w-md text-[13px] leading-[1.5] text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
