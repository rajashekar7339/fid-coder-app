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
    <div className="absolute inset-y-0 right-0 z-10 flex w-96 flex-col border-l border-border bg-dialog shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-medium">Routines</h2>
        <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-auto p-4">
        {routines.map((routine) => (
          <article key={routine.id} className="rounded-xl border border-border bg-card p-3 text-[14px]">
            <div className="flex items-center justify-between gap-2">
              <strong className="font-medium">{routine.name}</strong>
              <button
                type="button"
                className="text-[12.5px] text-muted-foreground hover:text-foreground"
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
            <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">{routine.prompt}</p>
            <p className="mt-1 font-mono text-[12px] text-faint-foreground">{routine.cron}</p>
            <p className="mt-1 text-[12.5px] text-faint-foreground">
              {routine.lastStatus ? `Last: ${routine.lastStatus}` : "Has not run"}
              {routine.nextRunAt ? ` · next ${new Date(routine.nextRunAt).toLocaleString()}` : ""}
            </p>
            <button
              type="button"
              className="mt-2 text-[12.5px] text-destructive"
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
          className="space-y-2 border-t border-border pt-3"
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
          <input className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input" placeholder="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <textarea className="min-h-20 w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input" placeholder="Prompt to run" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <input className="w-full rounded-xl border border-border bg-card px-3 py-2 font-mono text-[13px] outline-none focus:border-input" value={cron} onChange={(event) => setCron(event.target.value)} />
          <p className="text-[12.5px] leading-[1.5] text-muted-foreground">5-field cron. Example: * * * * * runs every minute. A new routine starts enabled. Use Disable to turn it off.</p>
          <button type="submit" className="rounded-lg bg-foreground px-3 py-1.5 text-[14px] text-background">
            Add routine
          </button>
        </form>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
