import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { groupToolCalls, liveTurnSettled, projectThread, userTurnAccepted, type LiveTurn } from "../../shared/chat-thread";
import type { Agent, ChatEvent, CopilotModel, Message } from "../../shared/types";
import { errorText, fid } from "../fid";
import { MessageContent } from "./MessageContent";
import { ModelSelect } from "./ModelSelect";
import { RoutineDrawer } from "./RoutineDrawer";

type Props = {
  agent: Agent;
  models: CopilotModel[];
  modelsNote: string | null;
  signedIn: boolean;
  checkingSignIn: boolean;
  onOpenSettings: () => void;
  onRetryModels: () => void;
  onUpdated: (agent: Agent) => void;
};

const liveByAgent = new Map<string, LiveTurn>();

function remember(agentId: string, live: LiveTurn | null) {
  if (live) liveByAgent.set(agentId, live);
  else liveByAgent.delete(agentId);
}

export function ChatView({
  agent,
  models,
  modelsNote,
  signedIn,
  checkingSignIn,
  onOpenSettings,
  onRetryModels,
  onUpdated,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [live, setLiveState] = useState<LiveTurn | null>(() => liveByAgent.get(agent.id) ?? null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(() => liveByAgent.has(agent.id));
  const [error, setError] = useState<string | null>(null);
  const [showRoutines, setShowRoutines] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
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

  useEffect(() => {
    const gen = ++generation.current;
    let cancelled = false;
    setError(null);
    setShowRoutines(false);
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
          ? (current ?? { userText: "", assistant: "", toolLine: null, startedAt: Date.now() })
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
          return { userText: event.text, assistant: current?.assistant ?? "", toolLine: current?.toolLine ?? null, startedAt: current?.startedAt ?? Date.now() };
        });
      }
      if (event.type === "text") {
        setRunning(true);
        updateLive((current) => {
          const base = current ?? { userText: "", assistant: "", toolLine: null, startedAt: Date.now() };
          return { ...base, assistant: base.assistant + event.text };
        });
      }
      if (event.type === "tool-start") {
        const preview = event.text?.trim();
        const detail = preview ? `: ${preview.slice(0, 80)}` : "";
        updateLive((current) => {
          const base = current ?? { userText: "", assistant: "", toolLine: null, startedAt: Date.now() };
          return { ...base, toolLine: `Using ${event.toolName}${detail}…` };
        });
      }
      if (event.type === "tool-end") {
        updateLive((current) => (current ? { ...current, toolLine: null } : current));
      }
      if (event.type === "done" || event.type === "error") {
        if (event.type === "error") setError(event.error);
        const loadId = ++messageLoad.current;
        void fid()
          .messages.list(agent.id)
          .then((list) => {
            if (generation.current !== gen || loadId !== messageLoad.current) return;
            remember(agent.id, null);
            setMessages(list);
            setLiveState(null);
            setRunning(false);
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
  }, [agent.id, updateLive]);

  useEffect(() => {
    if (signedIn) composer.current?.focus();
  }, [agent.id, signedIn]);

  useLayoutEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = "0px";
    field.style.height = `${Math.min(field.scrollHeight, 192)}px`;
  }, [draft]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [projected.messages, projected.thinking, projected.toolLine, draft]);

  function handleScroll() {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    pinned.current = atBottom;
    setShowJump((current) => (current === !atBottom ? current : !atBottom));
  }

  function send() {
    const text = draft.trim();
    if (!text || running || sendLock.current) return;
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
    updateLive(() => ({ userText: text, assistant: "", toolLine: null, startedAt }));
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
        setError(errorText(caught));
      });
  }

  async function changeModel(model: string) {
    if (model === agent.model || savingModel || running) return;
    setSavingModel(true);
    setError(null);
    try {
      const saved = await fid().agents.update(agent.id, {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        workspaceDir: agent.workspaceDir,
        model,
      });
      onUpdated(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSavingModel(false);
    }
  }

  const empty = projected.messages.length === 0 && !projected.thinking;
  const initial = agent.name.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium">{agent.name}</h1>
          <p className="truncate text-[12.5px] text-faint-foreground">{agent.workspaceDir || "No workspace folder"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground" htmlFor="chat-model">
            Model
          </label>
          <ModelSelect
            id="chat-model"
            value={agent.model}
            models={models}
            disabled={running || savingModel}
            className="max-w-52 rounded-lg border border-border bg-card px-2 py-1 text-[13px] outline-none focus:border-input"
            onChange={(model) => void changeModel(model)}
          />
          {modelsNote ? (
            <button type="button" className="text-[12.5px] text-destructive underline" title={modelsNote} onClick={onRetryModels}>
              Retry
            </button>
          ) : null}
        </div>
        <button type="button" className="rounded-full border border-border px-3 py-1 text-[13px] text-foreground/75 hover:bg-accent" onClick={() => setShowRoutines(true)}>
          Routines
        </button>
      </header>

      {!signedIn ? (
        <div className="flex items-center justify-between bg-warning/10 px-4 py-2 text-[13px] text-warning">
          <span>{checkingSignIn ? "Checking Copilot sign-in…" : "Sign in to Copilot before sending a message."}</span>
          <button type="button" className="underline" onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      ) : null}

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col overflow-y-auto" onScroll={handleScroll}>
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-card text-[15px] font-medium text-foreground">{initial}</div>
            <h2 className="mt-4 text-[20px] font-medium tracking-tight">{agent.name}</h2>
            <p className="mt-2 max-w-sm text-[13px] text-muted-foreground">Send a message to start.</p>
          </div>
        ) : (
          <div role="log" aria-label={`Conversation with ${agent.name}`} className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
            {groupToolCalls(projected.messages).map((item) =>
              item.kind === "tools" ? (
                <ToolGroup key={item.id} calls={item.calls} />
              ) : (
                <MessageRow
                  key={item.message.id}
                  message={item.message}
                  streaming={projected.streaming && item.message.id === "live-assistant"}
                  copied={copiedId === item.message.id}
                  onCopy={(content) => {
                    void navigator.clipboard.writeText(content).then(() => {
                      setCopiedId(item.message.id);
                      window.setTimeout(() => setCopiedId((current) => (current === item.message.id ? null : current)), 1200);
                    });
                  }}
                />
              ),
            )}
            {projected.toolLine ? <p className="text-[13px] text-muted-foreground">{projected.toolLine}</p> : projected.thinking ? <TypingIndicator /> : null}
          </div>
        )}
      </div>

      {showJump ? (
        <button
          type="button"
          className="absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-foreground shadow-md"
          onClick={() => {
            pinned.current = true;
            setShowJump(false);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Jump to latest
        </button>
      ) : null}

      {error ? <p className="px-4 py-2 text-center text-[13px] text-destructive">{error}</p> : null}

      <form
        className="px-4 pb-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[26px] border border-border bg-background py-[9px] pl-4 pr-2.5 focus-within:border-input">
          <textarea
            ref={composer}
            rows={1}
            className="max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[15.5px] leading-[1.45] outline-none placeholder:text-muted-foreground"
            value={draft}
            placeholder={signedIn ? `Message ${agent.name}` : checkingSignIn ? "Checking Copilot sign-in…" : "Sign in to Copilot to chat"}
            disabled={!signedIn}
            aria-label={`Message ${agent.name}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button
              type="button"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background"
              aria-label="Stop generating"
              onClick={() => {
                void fid()
                  .chat.abort(agent.id)
                  .catch((caught: unknown) => setError(errorText(caught)));
              }}
            >
              <span className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
            </button>
          ) : (
            <button
              type="submit"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:bg-accent disabled:text-muted-foreground"
              aria-label="Send message"
              disabled={!signedIn || !draft.trim()}
            >
              <ArrowUp />
            </button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11.5px] text-faint-foreground">Enter to send. Shift+Enter for a new line.</p>
      </form>
      {showRoutines ? <RoutineDrawer agentId={agent.id} onClose={() => setShowRoutines(false)} /> : null}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Thinking">
      <span className="fid-typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
      <span className="fid-typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
      <span className="fid-typing-dot h-2 w-2 rounded-full bg-muted-foreground" />
    </div>
  );
}

function ArrowUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3.5M8 3.5 4.5 7M8 3.5 11.5 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MessageRow({
  message,
  streaming,
  copied,
  onCopy,
}: {
  message: Message;
  streaming: boolean;
  copied: boolean;
  onCopy: (content: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[min(85%,40rem)] whitespace-pre-wrap break-words rounded-[20px] bg-chat-user px-[18px] py-3 text-[15.5px] leading-[1.45] text-white">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="group max-w-full">
      <div className="rounded-[20px] bg-muted px-[18px] py-3 text-[15.5px] leading-[1.5] text-foreground/90">
        <MessageContent text={message.content} />
        {streaming ? <span className="ml-0.5 inline-block h-4 w-[3px] translate-y-0.5 animate-pulse bg-foreground align-middle" /> : null}
      </div>
      <button
        type="button"
        className="mt-1 rounded-lg px-2 py-1 text-[12px] text-muted-foreground opacity-0 hover:bg-accent group-hover:opacity-100 focus:opacity-100"
        onClick={() => onCopy(message.content)}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function ToolGroup({ calls }: { calls: Message[] }) {
  const [open, setOpen] = useState(false);
  const label = calls.length === 1 ? "1 tool call" : `${calls.length} tool calls`;
  return (
    <div className="text-[13px] text-muted-foreground">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[12.5px] text-foreground/75 hover:bg-accent"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Chevron open={open} />
        {open ? "Hide tool calls" : label}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {calls.map((call) => {
            const splitAt = call.content.indexOf(": ");
            const name = splitAt === -1 ? call.content : call.content.slice(0, splitAt);
            const body = splitAt === -1 ? "" : call.content.slice(splitAt + 2);
            return (
              <div key={call.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <p className="border-b border-border px-3 py-1.5 font-mono text-[12px] text-foreground/80">{name}</p>
                {body ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-[12px] text-muted-foreground">{body}</pre> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={open ? "rotate-90" : ""}>
      <path d="M4.5 2.5 8 6 4.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
