import { useState, type FormEvent } from "react";
import { FolderOpen, X } from "lucide-react";
import { AUTO_MODEL_ID } from "../../shared/model";
import { DEFAULT_TOOL_PROFILE } from "../../shared/tool-profile";
import type { Agent, AgentToolProfile, CopilotModel } from "../../shared/types";
import { errorText, fid } from "../fid";
import { AgentAvatar } from "./AgentAvatar";
import { Modal } from "./Modal";
import { ModelSelect } from "./ModelSelect";

type Props = {
  agent: Agent | null;
  models: CopilotModel[];
  modelsNote: string | null;
  modelsLoading: boolean;
  onRetryModels: () => void;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
};

const DEFAULT_INSTRUCTIONS = "You are a helpful local assistant. Use tools when they help the user.";

export function AgentDialog({
  agent,
  models,
  modelsNote,
  modelsLoading,
  onRetryModels,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? DEFAULT_INSTRUCTIONS);
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [model, setModel] = useState(agent?.model ?? AUTO_MODEL_ID);
  const [toolProfile, setToolProfile] = useState<AgentToolProfile>(agent?.toolProfile ?? DEFAULT_TOOL_PROFILE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give this agent a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: trimmedName,
        description: description.trim(),
        systemPrompt: systemPrompt.trim() || DEFAULT_INSTRUCTIONS,
        workspaceDir: workspaceDir.trim() || null,
        model,
        toolProfile,
      };
      const saved = agent ? await fid().agents.update(agent.id, input) : await fid().agents.create(input);
      onSaved(saved);
    } catch (caught) {
      setError(errorText(caught));
      setSaving(false);
    }
  }

  const previewAgent = {
    id: agent?.id ?? `draft-${name}`,
    name: name.trim() || "New agent",
    description,
    systemPrompt,
  };

  return (
    <Modal label={agent ? "Edit agent" : "New agent"} className="agent-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">{agent ? "Agent settings" : "Add a teammate"}</div>
          <div className="modal-title">{agent ? "Edit agent" : "New agent"}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <form className="agent-form" onSubmit={(event) => void save(event)}>
        <div className="agent-form-scroll">
          <div className="agent-preview-row">
            <AgentAvatar agent={previewAgent} size="md" />
            <div>
              <div className="agent-preview-name">{name.trim() || "New agent"}</div>
              <div className="agent-preview-note">Runs on this PC with its own browser profile.</div>
            </div>
          </div>

          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              autoFocus
              value={name}
              placeholder="Name this agent"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">
              Role <span className="field-optional">Optional</span>
            </span>
            <input
              className="input"
              value={description}
              maxLength={160}
              placeholder="A short description, like “Jira teammate”"
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Instructions</span>
            <textarea
              className="textarea agent-instructions"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
            <span className="field-note">This becomes the agent's system prompt.</span>
          </label>

          <div className="field">
            <span className="field-label">Model</span>
            <ModelSelect
              value={model}
              models={models}
              disabled={saving}
              className="model-picker-wide"
              onChange={setModel}
            />
            <span className="field-note">
              {modelsLoading
                ? "Loading available models…"
                : "Auto lets Copilot choose the model for this agent."}
            </span>
            {modelsNote ? (
              <button type="button" className="field-link" onClick={onRetryModels}>
                {modelsNote} Retry
              </button>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor="agent-tools">
              Tools
            </label>
            <select
              id="agent-tools"
              className="select"
              value={toolProfile}
              disabled={saving}
              onChange={(event) => setToolProfile(event.target.value as AgentToolProfile)}
            >
              <option value="all">All tools — browser, shell, and files</option>
              <option value="browser">Browser only</option>
              <option value="developer">Shell + files only</option>
            </select>
            <span className="field-note">
              Browser-only agents cannot run commands or touch files. Shell + files agents cannot control a browser.
            </span>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="agent-workspace">
              Workspace
            </label>
            <span className="field-inline">
              <input
                id="agent-workspace"
                className="input"
                value={workspaceDir}
                placeholder="Optional folder for shell and files"
                onChange={(event) => setWorkspaceDir(event.target.value)}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void fid()
                    .dialog.pickFolder()
                    .then((folder) => {
                      if (folder) setWorkspaceDir(folder);
                    })
                    .catch((caught: unknown) => setError(errorText(caught)));
                }}
              >
                <FolderOpen size={13} />
                Browse
              </button>
            </span>
            <span className="field-note">
              {toolProfile === "browser"
                ? "Browser-only agents do not use a workspace folder."
                : "Without a folder, this agent cannot use shell or file tools."}
            </span>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="modal-footer">
          <span className="footer-spacer" />
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : agent ? "Save changes" : "Create agent"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
