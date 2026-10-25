import { useEffect, useState } from "react";
import type { Routine } from "../../shared/types";
import { errorText, fid } from "../fid";

type Props = {
  agentId: string;
  onClose: () => void;
};

export function RoutineDrawer({ agentId, onClose }: Props) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cron, setCron] = useState("0 9 * * 1-5");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setRoutines(await fid().routines.list(agentId));
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(errorText(caught)));
  }, [agentId]);

  return (
    <div className="absolute inset-y-0 right-0 z-10 flex w-96 flex-col border-l border-zinc-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="font-medium">Routines</h2>
        <button type="button" className="text-sm text-zinc-500" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {routines.map((routine) => (
          <article key={routine.id} className="rounded-md border border-zinc-200 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <strong>{routine.name}</strong>
              <button
                type="button"
                className="text-xs text-zinc-500"
                onClick={() => {
                  void fid()
                    .routines.update(routine.id, { enabled: !routine.enabled })
                    .then(load)
                    .catch((caught: unknown) => setError(errorText(caught)));
                }}
              >
                {routine.enabled ? "Disable" : "Enable"}
              </button>
            </div>
            <p className="mt-1 text-zinc-600">{routine.prompt}</p>
            <p className="mt-1 font-mono text-xs text-zinc-500">{routine.cron}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {routine.lastStatus ? `Last: ${routine.lastStatus}` : "Has not run"}
              {routine.nextRunAt ? ` · next ${new Date(routine.nextRunAt).toLocaleString()}` : ""}
            </p>
            <button
              type="button"
              className="mt-2 text-xs text-red-700"
              onClick={() => {
                void fid()
                  .routines.delete(routine.id)
                  .then(load)
                  .catch((caught: unknown) => setError(errorText(caught)));
              }}
            >
              Delete
            </button>
          </article>
        ))}
        <form
          className="space-y-2 border-t border-zinc-200 pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void fid()
              .routines.create({ agentId, name, prompt, cron, enabled: true, notify: true })
              .then(() => {
                setName("");
                setPrompt("");
                return load();
              })
              .catch((caught: unknown) => setError(errorText(caught)));
          }}
        >
          <input className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <textarea className="min-h-20 w-full rounded-md border border-zinc-300 px-2 py-1 text-sm" placeholder="Prompt to run" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <input className="w-full rounded-md border border-zinc-300 px-2 py-1 font-mono text-sm" value={cron} onChange={(event) => setCron(event.target.value)} />
          <p className="text-xs text-zinc-500">5-field cron. Example: * * * * * runs every minute. A new routine starts enabled. Use Disable to turn it off.</p>
          <button type="submit" className="rounded-md bg-zinc-950 px-3 py-1.5 text-sm text-white">
            Add routine
          </button>
        </form>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </div>
    </div>
  );
}
