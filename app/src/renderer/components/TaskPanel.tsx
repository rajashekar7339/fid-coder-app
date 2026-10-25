import { useEffect, useState } from "react";
import type { Task } from "../../shared/types";
import { errorText, fid } from "../fid";

type Props = { agentId: string };

export function TaskPanel({ agentId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setTasks(await fid().tasks.list(agentId));
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(errorText(caught)));
  }, [agentId]);

  return (
    <div className="border-t border-zinc-200 bg-white px-4 py-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Tasks</div>
      <div className="mb-2 flex gap-2">
        <input className="min-w-0 flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm" value={title} placeholder="Add a task" onChange={(event) => setTitle(event.target.value)} />
        <input className="rounded-md border border-zinc-300 px-2 py-1 text-sm" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        <button
          type="button"
          className="rounded-md bg-zinc-950 px-3 py-1 text-sm text-white"
          onClick={() => {
            void fid()
              .tasks.add({ agentId, title, dueAt: dueAt ? new Date(dueAt).toISOString() : null })
              .then(() => {
                setTitle("");
                setDueAt("");
                return load();
              })
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          Add
        </button>
      </div>
      <ul className="max-h-28 space-y-1 overflow-auto text-sm">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={task.done}
              onChange={(event) => {
                void fid()
                  .tasks.setDone(task.id, event.target.checked)
                  .then(load)
                  .catch((caught: unknown) => setError(errorText(caught)));
              }}
            />
            <span className={task.done ? "text-zinc-400 line-through" : ""}>{task.title}</span>
            {task.dueAt ? <span className="text-xs text-zinc-500">{new Date(task.dueAt).toLocaleString()}</span> : null}
            <button
              type="button"
              className="ml-auto text-xs text-zinc-500"
              onClick={() => {
                void fid()
                  .tasks.delete(task.id)
                  .then(load)
                  .catch((caught: unknown) => setError(errorText(caught)));
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-1 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
