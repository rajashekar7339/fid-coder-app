import { useState } from "react";
import { AUTO_MODEL_ID } from "../../shared/model";
import type { Agent, CopilotModel } from "../../shared/types";
import { errorText, fid } from "../fid";
import { ModelSelect } from "./ModelSelect";

type Props = {
  agent: Agent | null;
  models: CopilotModel[];
  modelsNote: string | null;
  modelsLoading: boolean;
  onRetryModels: () => void;
  onCancel: () => void;
  onSaved: (agent: Agent) => void;
};

export function AgentForm({ agent, models, modelsNote, modelsLoading, onRetryModels, onCancel, onSaved }: Props) {
  const [name, setName] = useState(agent?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [model, setModel] = useState(agent?.model ?? AUTO_MODEL_ID);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, systemPrompt, workspaceDir: workspaceDir || null, model };
      const saved = agent ? await fid().agents.update(agent.id, input) : await fid().agents.create(input);
      onSaved(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-[13px] leading-[1.5] text-muted-foreground">Name, responsibility, and model are stored on this machine.</p>
      <label className="block text-[14px]">
        <span className="mb-1 block font-medium">Name</span>
        <input className="w-full rounded-xl border border-border bg-card px-3 py-2 outline-none focus:border-input" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-[14px]">
        <span className="mb-1 block font-medium">Responsibility</span>
        <textarea
          className="min-h-48 w-full rounded-xl border border-border bg-card px-3 py-2 outline-none focus:border-input"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </label>
      <div className="block text-[14px]">
        <label className="mb-1 block font-medium" htmlFor="agent-model">
          Model
        </label>
        <ModelSelect id="agent-model" value={model} models={models} disabled={saving} onChange={setModel} />
        <p className="mt-1 text-[13px] leading-[1.5] text-muted-foreground">
          {modelsLoading ? "Loading available models…" : "Auto is the default. Copilot chooses the model for this agent."}
        </p>
        {modelsNote ? (
          <p className="mt-1 text-[13px] text-destructive">
            {modelsNote}{" "}
            <button type="button" className="underline" onClick={onRetryModels}>
              Retry
            </button>
          </p>
        ) : null}
      </div>
      <label className="block text-[14px]">
        <span className="mb-1 block font-medium">Workspace folder</span>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 outline-none placeholder:text-muted-foreground focus:border-input"
            value={workspaceDir}
            onChange={(event) => setWorkspaceDir(event.target.value)}
            placeholder="Used by shell and file tools"
          />
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 hover:bg-accent"
            onClick={() => {
              void fid()
                .dialog.pickFolder()
                .then((folder) => {
                  if (folder) setWorkspaceDir(folder);
                })
                .catch((caught: unknown) => setError(errorText(caught)));
            }}
          >
            Browse
          </button>
        </div>
      </label>
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className="rounded-lg bg-foreground px-4 py-2 text-[14px] text-background disabled:opacity-50" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="rounded-lg border border-border px-4 py-2 text-[14px] hover:bg-accent" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
