import { useEffect, useRef, useState } from "react";
import type { Agent, ChatEvent, Message } from "../../shared/types";
import { errorText, fid } from "../fid";
import { RoutineDrawer } from "./RoutineDrawer";

type Props = {
  agent: Agent;
  signedIn: boolean;
  checkingSignIn: boolean;
  onEdit: () => void;
  onOpenSettings: () => void;
  onDeleted: () => void;
};

export function ChatView({ agent, signedIn, checkingSignIn, onEdit, onOpenSettings, onDeleted }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState("");
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRoutines, setShowRoutines] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  async function load() {
    setMessages(await fid().messages.list(agent.id));
  }

  useEffect(() => {
    setStreaming("");
    setToolLine(null);
    setError(null);
    setShowRoutines(false);
    void load().catch((caught: unknown) => setError(errorText(caught)));
  }, [agent.id]);

  useEffect(() => {
    const id = fid().chat.onEvent((event: ChatEvent) => {
      if (event.agentId !== agent.id) return;
      if (event.type === "text") setStreaming((current) => current + event.text);
      if (event.type === "tool-start") setToolLine(`${event.toolName} ${event.text ?? ""}`.trim());
      if (event.type === "tool-end") setToolLine(`${event.ok ? "Done" : "Failed"}: ${event.toolName}`);
      if (event.type === "done" || event.type === "error") {
        setStreaming("");
        setToolLine(null);
        setRunning(false);
        if (event.type === "error") setError(event.error);
        void load();
      }
    });
    return () => fid().chat.offEvent(id);
  }, [agent.id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, streaming, toolLine]);

  async function send() {
    const text = draft.trim();
    if (!text || running) return;
    setDraft("");
    setError(null);
    setRunning(true);
    setStreaming("");
    try {
      await fid().chat.send(agent.id, text);
    } catch (caught) {
      setError(errorText(caught));
      setRunning(false);
      await load();
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{agent.name}</h1>
          <p className="truncate text-xs text-zinc-500">{agent.workspaceDir || "No workspace folder"}</p>
        </div>
        <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm" onClick={() => setShowRoutines(true)}>
          Routines
        </button>
        <button type="button" className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm" onClick={onEdit}>
          Edit
        </button>
        <button
          type="button"
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700"
          onClick={() => {
            if (!window.confirm(`Delete ${agent.name}? This removes its chat, routines, and browser profile.`)) return;
            void fid()
              .agents.delete(agent.id)
              .then(onDeleted)
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          Delete
        </button>
      </header>

      {!signedIn ? (
        <div className="flex items-center justify-between bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>{checkingSignIn ? "Checking Copilot sign-in…" : "Sign in to Copilot before sending a message."}</span>
          <button type="button" className="underline" onClick={onOpenSettings}>
            Open settings
          </button>
        </div>
      ) : null}

      <div ref={scroller} className="flex-1 space-y-3 overflow-auto px-4 py-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {streaming ? <MessageBubble message={{ id: "stream", agentId: agent.id, role: "assistant", content: streaming, createdAt: "" }} /> : null}
        {toolLine ? <p className="font-mono text-xs text-zinc-500">{toolLine}</p> : null}
      </div>

      {error ? <p className="bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : null}

      <form
        className="flex gap-2 border-t border-zinc-200 bg-white p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          className="min-h-12 flex-1 resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={draft}
          placeholder={signedIn ? `Message ${agent.name}` : checkingSignIn ? "Checking Copilot sign-in…" : "Sign in to Copilot to chat"}
          disabled={!signedIn}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {running ? (
          <button type="button" className="rounded-md border border-zinc-300 px-4 py-2 text-sm" onClick={() => void fid().chat.abort(agent.id)}>
            Stop
          </button>
        ) : (
          <button type="submit" className="rounded-md bg-zinc-950 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!signedIn || !draft.trim()}>
            Send
          </button>
        )}
      </form>
      {showRoutines ? <RoutineDrawer agentId={agent.id} onClose={() => setShowRoutines(false)} /> : null}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "tool") {
    return <pre className="overflow-auto whitespace-pre-wrap rounded-md bg-zinc-100 px-3 py-2 font-mono text-xs text-zinc-600">{message.content}</pre>;
  }
  const mine = message.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[75%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${mine ? "bg-zinc-950 text-white" : "border border-zinc-200 bg-white"}`}>
        {message.content}
      </div>
    </div>
  );
}
