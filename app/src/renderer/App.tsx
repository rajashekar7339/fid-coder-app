import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, SettingsView } from "../shared/types";
import { AgentForm } from "./components/AgentForm";
import { ChatView } from "./components/ChatView";
import { SettingsView as SettingsScreen } from "./components/SettingsView";
import { Sidebar, type CopilotPresence } from "./components/Sidebar";
import { errorText, fid } from "./fid";

type View =
  | { kind: "chat"; agentId: string }
  | { kind: "edit"; agentId: string | null }
  | { kind: "settings" };

type SignInNote = { tone: "progress" | "ok" | "error"; text: string };

const SIGN_IN_POLL_MS = 2000;
const SIGN_IN_TIMEOUT_MS = 3 * 60 * 1000;

export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [view, setView] = useState<View>({ kind: "edit", agentId: null });
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkingSignIn, setCheckingSignIn] = useState(false);
  const [signInNote, setSignInNote] = useState<SignInNote | null>(null);
  const signInWatch = useRef(0);
  const signInTimer = useRef<number | null>(null);

  const refreshAgents = useCallback(async () => {
    const list = await fid().agents.list();
    setAgents(list);
    return list;
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

  useEffect(() => {
    if (!window.fid) {
      setLoadError("Open Fid Coder from the desktop app. The page has no connection to the local agent engine.");
      return;
    }
    void refreshAgents()
      .then((list) => {
        if (list[0]) setView({ kind: "chat", agentId: list[0].id });
      })
      .catch((error: unknown) => setLoadError(errorText(error)));
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
  }, [refreshAgents, refreshSettings]);

  useEffect(() => {
    if (view.kind !== "settings") return;
    void refreshSettings().catch((error: unknown) => setLoadError(errorText(error)));
  }, [view.kind, refreshSettings]);

  useEffect(() => {
    const onFocus = () => {
      void refreshSettings().catch(() => undefined);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshSettings]);

  const selected = agents.find((agent) => view.kind !== "settings" && agent.id === view.agentId) ?? null;
  const copilotPresence: CopilotPresence = settings?.signedIn ? "ready" : checkingSignIn ? "checking" : settings === null ? "unknown" : "out";

  if (loadError && agents.length === 0 && !window.fid) {
    return <FullMessage title="Fid Coder" body={loadError} />;
  }

  return (
    <div className="flex h-full">
      <Sidebar
        agents={agents}
        selectedId={view.kind === "chat" || view.kind === "edit" ? view.agentId : null}
        settingsOpen={view.kind === "settings"}
        copilotPresence={copilotPresence}
        onSelect={(agentId) => setView({ kind: "chat", agentId })}
        onCreate={() => setView({ kind: "edit", agentId: null })}
        onSettings={() => setView({ kind: "settings" })}
      />
      <main className="min-w-0 flex-1">
        {loadError ? <p className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{loadError}</p> : null}
        {view.kind === "settings" ? (
          <SettingsScreen
            settings={settings}
            checkingSignIn={checkingSignIn}
            signInNote={signInNote}
            onStartSignIn={() => void startSignIn()}
            onSaved={() => {
              void refreshSettings();
            }}
            onSignedOut={(next) => {
              stopSignInWatch();
              setCheckingSignIn(false);
              setSignInNote(null);
              setSettings(next);
            }}
          />
        ) : view.kind === "edit" ? (
          <AgentForm
            agent={selected}
            onCancel={() => {
              if (selected) setView({ kind: "chat", agentId: selected.id });
              else if (agents[0]) setView({ kind: "chat", agentId: agents[0].id });
            }}
            onSaved={(agent) => {
              void refreshAgents().then(() => setView({ kind: "chat", agentId: agent.id }));
            }}
          />
        ) : selected ? (
          <ChatView
            agent={selected}
            signedIn={settings?.signedIn ?? false}
            checkingSignIn={checkingSignIn}
            onEdit={() => setView({ kind: "edit", agentId: selected.id })}
            onOpenSettings={() => setView({ kind: "settings" })}
            onDeleted={() => {
              void refreshAgents().then((list) => {
                if (list[0]) setView({ kind: "chat", agentId: list[0].id });
                else setView({ kind: "edit", agentId: null });
              });
            }}
          />
        ) : (
          <FullMessage title="No agents yet" body="Create an agent to start a conversation." />
        )}
      </main>
    </div>
  );
}

function FullMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-zinc-600">{body}</p>
      </div>
    </div>
  );
}
