import { useState, type FormEvent } from "react";
import { FolderOpen, X } from "lucide-react";
import { AUTO_MODEL_ID } from "../../../shared/model";
import { DEFAULT_TOOL_PROFILE } from "../../../shared/tool-profile";
import type { Agent, AgentToolProfile, CopilotModel } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { AgentAvatar } from "./AgentAvatar";
import { Modal } from "../ui/Modal";
import { ModelSelect } from "../ui/ModelSelect";
import { Switch } from "../ui/Switch";

type Props = {
  agent: Agent | null;
  models: CopilotModel[];
  modelsNote: string | null;
  modelsLoading: boolean;
  onRetryModels: () => void;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
  onMemoryCleared?: (agent: Agent) => void;
};

const DEFAULT_INSTRUCTIONS = "You are a helpful local assistant. Use tools when they help the user.";
const GUIDE_INSTRUCTIONS =
  "You are a codebase guide. Answer questions about this repository. Read the code before you answer, cite evidence as path:line, and use Mermaid diagrams for flows. Do not edit files or run commands. If the user wants a change, tell them to switch to Code.";
const MEMORY_PREVIEW_CHARS = 320;
const MEMORY_PREVIEW_LINES = 4;

type AgentTemplate = "guide" | "general";

function memoryPreview(text: string): string {
  const first = text.split(/\r?\n/).slice(0, MEMORY_PREVIEW_LINES).join("\n");
  if (first.length <= MEMORY_PREVIEW_CHARS) return `${first.trimEnd()}…`;
  const cut = text.slice(0, MEMORY_PREVIEW_CHARS);
  const line = cut.lastIndexOf("\n");
  const body = (line > MEMORY_PREVIEW_CHARS / 2 ? cut.slice(0, line) : cut).trimEnd();
  return `${body}…`;
}

export function AgentDialog({
  agent,
  models,
  modelsNote,
  modelsLoading,
  onRetryModels,
  onClose,
  onSaved,
  onMemoryCleared,
}: Props) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? GUIDE_INSTRUCTIONS);
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [model, setModel] = useState(agent?.model ?? AUTO_MODEL_ID);
  const [toolProfile, setToolProfile] = useState<AgentToolProfile>(
    agent?.toolProfile ?? (agent ? DEFAULT_TOOL_PROFILE : "developer"),
  );
  const [readOnly, setReadOnly] = useState(agent?.readOnly ?? true);
  const [template, setTemplate] = useState<AgentTemplate>("guide");
  const [memorySummary, setMemorySummary] = useState(agent?.memorySummary ?? "");
  const [memoryEnabled, setMemoryEnabled] = useState(agent?.memoryEnabled ?? true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function clearMemory() {
    if (!agent || clearingMemory || saving) return;
    setClearingMemory(true);
    setError(null);
    try {
      const cleared = await fid().agents.clearMemory(agent.id);
      setMemorySummary("");
      onMemoryCleared?.(cleared);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setClearingMemory(false);
    }
  }

  function applyTemplate(next: AgentTemplate) {
    setTemplate(next);
    if (next === "guide") {
      setReadOnly(true);
      setSystemPrompt(GUIDE_INSTRUCTIONS);
      setToolProfile("developer");
      return;
    }
    setReadOnly(false);
    setSystemPrompt(DEFAULT_INSTRUCTIONS);
    setToolProfile(DEFAULT_TOOL_PROFILE);
  }

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
        readOnly,
        memoryEnabled,
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
  const memoryTruncated =
    memorySummary.length > MEMORY_PREVIEW_CHARS || memorySummary.split(/\r?\n/).length > MEMORY_PREVIEW_LINES;
  const memoryShown = memoryOpen || !memoryTruncated ? memorySummary : memoryPreview(memorySummary);
  const memoryId = agent ? `agent-memory-${agent.id}` : undefined;

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

          {!agent ? (
            <div className="field">
              <span className="field-label">Start from</span>
              <div className="agent-templates" role="group" aria-label="Agent template">
                <button
                  type="button"
                  className={`agent-template ${template === "guide" ? "is-active" : ""}`}
                  aria-pressed={template === "guide"}
                  onClick={() => applyTemplate("guide")}
                >
                  <strong>Codebase guide</strong>
                  <span>Read code, explain flows, and review architecture. No edits.</span>
                </button>
                <button
                  type="button"
                  className={`agent-template ${template === "general" ? "is-active" : ""}`}
                  aria-pressed={template === "general"}
                  onClick={() => applyTemplate("general")}
                >
                  <strong>General agent</strong>
                  <span>Full tools for edits, commands, and browser work.</span>
                </button>
              </div>
            </div>
          ) : null}

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
              placeholder="You are a coding agent. Help with code changes, tests, and questions about this project."
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
            <span className="field-note">
              Sent with every message. Write standing instructions, not a one-time task.
            </span>
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
              <option value="all">All tools — browser, Jira, shell, search, git, and files</option>
              <option value="browser">Browser and Jira</option>
              <option value="developer">Shell, search, git, and files</option>
              <option value="analyst">Release analyst — search, git, and impact analysis</option>
            </select>
            <span className="field-note">
              Browser and Jira agents cannot run commands or touch files. Shell, search, git, and files agents cannot control a browser or read Jira. The release analyst writes reports under artifacts/ and does not edit source repos.
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
                placeholder="Optional folder for shell, search, git, and files"
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
                ? "Browser and Jira agents do not use a workspace folder."
                : toolProfile === "analyst"
                  ? "Point this at the folder that contains .release-impact/config.json. Reports are written under artifacts/."
                  : "Without a folder, this agent cannot use shell, search, git, or file tools."}
            </span>
          </div>

          {agent ? (
            <div className="field">
              <span className="field-label">Memory</span>
              <div className="memory-toggle">
                <Switch
                  checked={memoryEnabled}
                  disabled={saving}
                  label="Automatic memory"
                  onChange={setMemoryEnabled}
                />
                <span>Automatic memory</span>
              </div>
              <span className="field-note">
                {memoryEnabled
                  ? "Updates at most once every ten turns with Auto. Turn off to save Copilot usage."
                  : "Automatic updates are off. Turn on to keep memory current."}
              </span>
              {memorySummary.trim() ? (
                <>
                  <pre id={memoryId} className={`memory-summary ${memoryOpen ? "is-open" : ""}`}>{memoryShown}</pre>
                  <span className="field-note">Used when this agent starts a fresh Copilot session.</span>
                  <div className="field-actions">
                    {memoryTruncated ? (
                      <button
                        type="button"
                        className="text-button"
                        aria-expanded={memoryOpen}
                        aria-controls={memoryId}
                        onClick={() => setMemoryOpen((open) => !open)}
                      >
                        {memoryOpen ? "Show less" : "Show all"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-button"
                      disabled={clearingMemory || saving}
                      onClick={() => void clearMemory()}
                    >
                      {clearingMemory ? "Clearing…" : "Clear memory"}
                    </button>
                  </div>
                </>
              ) : (
                <span className="field-note">Nothing saved yet. A summary appears after 30 messages and ten turns.</span>
              )}
            </div>
          ) : null}

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
