import { useState, type FormEvent } from "react";
import { Check, FolderOpen, X } from "lucide-react";
import { DATADOG_AGENT_PROMPT } from "../../../shared/datadog";
import { AUTO_MODEL_ID } from "../../../shared/model";
import type { Agent, AgentToolProfile, CopilotModel } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { FactList } from "./FactList";
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

const DEFAULT_INSTRUCTIONS =
  "You are a helpful local assistant. Read the workspace and the conversation before you answer, use tools when they help, and cite file evidence as path:line. Keep replies short and say what you changed or found.";
const MEMORY_PREVIEW_CHARS = 320;
const MEMORY_PREVIEW_LINES = 4;

const INSTRUCTION_PRESETS = [
  {
    id: "general",
    label: "General",
    text: DEFAULT_INSTRUCTIONS,
  },
  {
    id: "codebase",
    label: "Codebase guide",
    text: "You are a codebase guide. Answer questions about this repository by reading the code first, not by guessing from names. Follow the entry points, callers, and tests that matter, cite evidence as path:line, and use a Mermaid flowchart for control flow or data flow. When the user asks for an architecture review, load the architecture-review skill with use_skill.",
  },
  {
    id: "review",
    label: "Code reviewer",
    text: "You review code changes like the person who will be paged when they break. Load the review-change skill with use_skill and follow it: understand the diff and its callers, then report correctness, safety, load, test, speed, and lean-code risks in priority order. Cite evidence as path:line and end with a verdict.",
  },
  {
    id: "implementer",
    label: "Implementer",
    text: "You are a careful coding agent. Load the write-lean skill with use_skill and follow it: read the code the change touches, name the full scope, reuse what is already there, and make the smallest complete change. Add one small test when the new logic can be wrong, run the relevant checks, and keep the reply short.",
  },
  {
    id: "debugger",
    label: "Debugger",
    text: "You troubleshoot from evidence. Read the failing path and the supplied logs, trace the actual flow with the file and explorer tools, and state the likely cause before proposing a fix. Cite evidence as path:line, separate confirmed facts from guesses, and suggest the smallest fix that addresses the cause.",
  },
  {
    id: "architecture",
    label: "Architecture reviewer",
    text: "You review a codebase's architecture. Load the architecture-review skill with use_skill and follow it: map the components and boundaries, trace two or three important runtime flows, and report coupling, risks, and test gaps. Cite evidence as path:line and keep the report structured.",
  },
  {
    id: "release",
    label: "Release notes",
    text: "You are a release assistant. Read the changelog and open pull requests, then draft release notes with the main changes, risks, and testing gaps. When the user wants a shareable page, load the html-report skill with use_skill and produce one self-contained HTML file.",
  },
  {
    id: "datadog",
    label: "Datadog analyst",
    text: DATADOG_AGENT_PROMPT,
  },
];

const TOOL_CHOICES: { value: AgentToolProfile; label: string }[] = [
  { value: "all", label: "All tools" },
  { value: "browser", label: "Browser and Jira" },
  { value: "developer", label: "Shell, search, git, and files" },
  { value: "datadog", label: "Datadog and workspace" },
];

function toolChoiceDetail(profile: AgentToolProfile): string {
  if (profile === "all") return "Browser, Jira, Datadog, shell, search, git, and files.";
  if (profile === "browser") return "Full browser control, Jira, and history.";
  if (profile === "datadog") return "Datadog log capture, browser, Jira, and workspace reads.";
  return "Shell, file writes, search, git, and history.";
}

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
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? DEFAULT_INSTRUCTIONS);
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [model, setModel] = useState(agent?.model ?? AUTO_MODEL_ID);
  const [toolProfile, setToolProfile] = useState<AgentToolProfile | null>(
    agent?.toolProfile ?? null,
  );
  const [readOnly, setReadOnly] = useState(agent?.readOnly ?? true);
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

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Give this agent a name.");
      return;
    }
    if (!readOnly && !toolProfile) {
      setError("Choose a tool profile.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: trimmedName,
        description: agent?.description ?? "",
        systemPrompt: systemPrompt.trim() || DEFAULT_INSTRUCTIONS,
        workspaceDir: workspaceDir.trim() || null,
        model,
        toolProfile: toolProfile ?? "developer",
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
    description: agent?.description ?? "",
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

          <div className="field">
            <label className="field-label" htmlFor="agent-instructions">
              Instructions
            </label>
            <div className="instruction-presets" role="group" aria-label="Instruction presets">
              {INSTRUCTION_PRESETS.map((preset) => {
                const active = systemPrompt.trim() === preset.text;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`instruction-preset ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() => setSystemPrompt(preset.text)}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <textarea
              id="agent-instructions"
              className="textarea agent-instructions"
              value={systemPrompt}
              placeholder="You are a coding agent. Help with code changes, tests, and questions about this project."
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
            <span className="field-note">
              Pick a starting point, then edit it. Sent with every message.
            </span>
          </div>

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
            <span className="field-label">Mode</span>
            <div className="mode-switch agent-mode-switch" role="group" aria-label="Agent mode">
              <button
                type="button"
                className={readOnly ? "is-active" : ""}
                aria-pressed={readOnly}
                disabled={saving}
                title="Ask mode: every read-only tool, regardless of the tool profile."
                onClick={() => setReadOnly(true)}
              >
                Ask mode
              </button>
              <button
                type="button"
                className={!readOnly ? "is-active" : ""}
                aria-pressed={!readOnly}
                disabled={saving}
                title="Agent mode: registers the full tools for the selected profile."
                onClick={() => setReadOnly(false)}
              >
                Agent mode
              </button>
            </div>
            <span className="field-note">
              {readOnly
                ? "Ask mode uses every read-only tool: files, search, git, browser pages, and Jira. No tool selection is needed."
                : "Agent mode uses the full tools for the profile below."}
            </span>
          </div>

          {!readOnly ? (
            <div className="field">
              <span className="field-label" id="agent-tools-label">
                Tools
              </span>
              <div className="tool-choices" role="radiogroup" aria-labelledby="agent-tools-label">
                {TOOL_CHOICES.map((choice) => {
                  const active = toolProfile === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={`tool-choice ${active ? "is-active" : ""}`}
                      disabled={saving}
                      onClick={() => setToolProfile(choice.value)}
                    >
                      <span className="tool-choice-head">
                        <strong>{choice.label}</strong>
                        {active ? <Check size={13} aria-hidden="true" /> : null}
                      </span>
                      <span className="tool-choice-detail">{toolChoiceDetail(choice.value)}</span>
                    </button>
                  );
                })}
              </div>
              <span className="field-note">
                {toolProfile ? "Full tools for Agent mode." : "Choose a tool profile to continue."}
              </span>
            </div>
          ) : null}

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
                  ? "Updates at most once every ten turns after 30 messages, using Auto. Send /compact to summarize now."
                  : "Automatic updates are off. Send /compact to summarize now, or turn this on to keep memory current."}
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
                <span className="field-note">Nothing saved yet. Send /compact, or wait until the thread passes 30 messages and ten turns.</span>
              )}
            </div>
          ) : null}

          {agent ? <FactList agentId={agent.id} /> : null}

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
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || (!readOnly && !toolProfile)}
          >
            {saving ? "Saving…" : agent ? "Save changes" : "Create agent"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
