import { useState } from "react";
import type { Agent } from "../../shared/types";
import { errorText, fid } from "../fid";

type Props = {
  agent: Agent | null;
  onCancel: () => void;
  onSaved: (agent: Agent) => void;
};

export function AgentForm({ agent, onCancel, onSaved }: Props) {
  const [name, setName] = useState(agent?.name ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const input = { name, systemPrompt, workspaceDir: workspaceDir || null };
      const saved = agent ? await fid().agents.update(agent.id, input) : await fid().agents.create(input);
      onSaved(saved);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 overflow-auto p-6">
      <div>
        <h1 className="text-xl font-semibold">{agent ? "Edit agent" : "New agent"}</h1>
        <p className="mt-1 text-sm text-zinc-600">Name and responsibility are stored on this machine.</p>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Name</span>
        <input className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Responsibility</span>
        <textarea
          className="min-h-48 w-full rounded-md border border-zinc-300 bg-white px-3 py-2"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Workspace folder</span>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2"
            value={workspaceDir}
            onChange={(event) => setWorkspaceDir(event.target.value)}
            placeholder="Used by shell and file tools"
          />
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2"
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
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className="rounded-md bg-zinc-950 px-4 py-2 text-sm text-white disabled:opacity-50" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
