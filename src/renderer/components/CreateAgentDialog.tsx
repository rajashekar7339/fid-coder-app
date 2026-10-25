import { useState } from "react";
import { AUTO_MODEL_ID } from "../../shared/model";
import type { Agent } from "../../shared/types";
import { errorText, fid } from "../fid";
import { Dialog } from "./Dialog";

const DEFAULT_RESPONSIBILITY = "You are a helpful local assistant. Use tools when they help the user.";

type Props = {
  onCancel: () => void;
  onCreated: (agent: Agent) => void;
};

export function CreateAgentDialog({ onCancel, onCreated }: Props) {
  const [name, setName] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || saving) {
      if (!trimmed) setError("Name is required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const agent = await fid().agents.create({
        name: trimmed,
        systemPrompt: responsibility.trim() || DEFAULT_RESPONSIBILITY,
        workspaceDir: null,
        model: AUTO_MODEL_ID,
      });
      onCreated(agent);
    } catch (caught) {
      setError(errorText(caught));
      setSaving(false);
    }
  }

  return (
    <Dialog title="New agent" onClose={() => { if (!saving) onCancel(); }}>
      <form
        className="flex flex-col gap-4 p-5 text-[14px]"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-[14px] font-medium">Name</span>
          <input
            autoFocus
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this agent"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[14px] font-medium">Responsibility</span>
          <textarea
            className="min-h-28 w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input"
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value)}
            placeholder="Optional. You can fill this in later from Edit."
          />
        </label>
        <p className="text-[13px] leading-[1.5] text-muted-foreground">The new agent uses Auto. Model and workspace folder can be changed from Edit.</p>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-lg border border-border px-4 py-2 text-[14px] hover:bg-accent" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="rounded-lg bg-foreground px-4 py-2 text-[14px] text-background disabled:opacity-50" disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
