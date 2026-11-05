import { useEffect, useRef, useState, type FormEvent } from "react";
import { FolderOpen, X } from "lucide-react";
import { AUTO_MODEL_ID } from "../../../shared/model";
import { MAX_SKILLS, MAX_SKILL_CHARS, MAX_SKILLS_CHARS } from "../../../shared/skills";
import { DEFAULT_TOOL_PROFILE } from "../../../shared/tool-profile";
import type { Agent, AgentToolProfile, CopilotModel, SkillContent, SkillInfo, SkillSource } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatCount } from "../../lib/format";
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
const MEMORY_PREVIEW_CHARS = 320;
const MEMORY_PREVIEW_LINES = 4;

const SOURCE_LABELS: Record<SkillSource, string> = {
  workspace: "Workspace",
  app: "Your skills",
  copilot: "Copilot",
  builtin: "Built-in",
};

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
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? DEFAULT_INSTRUCTIONS);
  const [workspaceDir, setWorkspaceDir] = useState(agent?.workspaceDir ?? "");
  const [model, setModel] = useState(agent?.model ?? AUTO_MODEL_ID);
  const [toolProfile, setToolProfile] = useState<AgentToolProfile>(agent?.toolProfile ?? DEFAULT_TOOL_PROFILE);
  const [memorySummary, setMemorySummary] = useState(agent?.memorySummary ?? "");
  const [memoryEnabled, setMemoryEnabled] = useState(agent?.memoryEnabled ?? true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [skillIds, setSkillIds] = useState<string[]>(agent?.skillIds ?? []);
  const [catalog, setCatalog] = useState<SkillInfo[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogNote, setCatalogNote] = useState<string | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCatalogNote(null);
      void fid()
        .skills.list(workspaceDir.trim() || null)
        .then((result) => {
          if (cancelled) return;
          setCatalog(result.skills);
          setWarnings(result.warnings);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setCatalogNote(errorText(caught));
        })
        .finally(() => {
          if (!cancelled) setCatalogLoaded(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceDir, catalogVersion]);

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
        memoryEnabled,
        skillIds,
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

          <SkillsField
            key={workspaceDir}
            workspaceDir={workspaceDir.trim() || null}
            catalog={catalog}
            catalogNote={catalogNote}
            catalogLoaded={catalogLoaded}
            warnings={warnings}
            skillIds={skillIds}
            disabled={saving}
            onToggle={(id, checked) =>
              setSkillIds((current) => {
                if (!checked) return current.filter((item) => item !== id);
                if (current.includes(id) || current.length >= MAX_SKILLS) return current;
                return [...current, id];
              })
            }
            onRefresh={() => setCatalogVersion((version) => version + 1)}
            onError={setError}
          />

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

function SkillsField({
  workspaceDir,
  catalog,
  catalogNote,
  catalogLoaded,
  warnings,
  skillIds,
  disabled,
  onToggle,
  onRefresh,
  onError,
}: {
  workspaceDir: string | null;
  catalog: SkillInfo[];
  catalogNote: string | null;
  catalogLoaded: boolean;
  warnings: string[];
  skillIds: string[];
  disabled: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}) {
  const limitReached = skillIds.length >= MAX_SKILLS;
  const missing = catalogLoaded ? skillIds.filter((id) => !catalog.some((skill) => skill.id === id)) : [];
  const selectedChars = catalog.reduce((sum, skill) => sum + (skillIds.includes(skill.id) ? skill.chars : 0), 0);
  const overBudget = selectedChars > MAX_SKILLS_CHARS;
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillContent | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequest = useRef(0);

  async function togglePreview(skill: SkillInfo) {
    const key = `${skill.source}:${skill.id}`;
    if (previewKey === key) {
      setPreviewKey(null);
      setPreview(null);
      setPreviewNote(null);
      return;
    }
    const request = ++previewRequest.current;
    setPreviewKey(key);
    setPreview(null);
    setPreviewNote(null);
    setPreviewLoading(true);
    try {
      const content = await fid().skills.read(workspaceDir, skill.id, skill.source);
      if (previewRequest.current !== request) return;
      setPreview(content);
      if (!content) setPreviewNote("The skill file could not be found.");
    } catch (caught) {
      if (previewRequest.current === request) setPreviewNote(errorText(caught));
    } finally {
      if (previewRequest.current === request) setPreviewLoading(false);
    }
  }

  function refresh() {
    setPreviewKey(null);
    setPreview(null);
    setPreviewNote(null);
    onRefresh();
  }

  return (
    <div className="field">
      <span className="field-label">
        Skills
        {skillIds.length > 0 ? (
          <span className="field-optional">
            {skillIds.length}/{MAX_SKILLS}
          </span>
        ) : null}
      </span>
      <div className="skill-options">
        {catalog.map((skill) => {
          const checked = skillIds.includes(skill.id);
          const atLimit = limitReached && !checked;
          const key = `${skill.source}:${skill.id}`;
          return (
            <div key={key} className="skill-option-wrap">
              <label
                className={`skill-option ${checked ? "is-selected" : ""} ${disabled || atLimit ? "is-disabled" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || atLimit}
                  onChange={(event) => onToggle(skill.id, event.target.checked)}
                />
                <span className="skill-option-copy">
                  <span className="skill-name">{skill.name}</span>
                  <span className="skill-note">{skill.description}</span>
                  <span className="skill-meta">
                    <span>{SOURCE_LABELS[skill.source]}</span>
                    <span>{formatCount(skill.chars)} chars</span>
                    {skill.chars > MAX_SKILL_CHARS ? <span className="skill-warning">will be truncated</span> : null}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-button skill-view"
                  disabled={disabled}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void togglePreview(skill);
                  }}
                >
                  {previewKey === key ? "Hide" : "View"}
                </button>
              </label>
              {previewKey === key ? (
                <div className="skill-preview">
                  {previewLoading ? <span className="field-note">Loading…</span> : null}
                  {previewNote ? <span className="field-note">{previewNote}</span> : null}
                  {preview ? (
                    <>
                      <div className="skill-preview-head">
                        <span>{SOURCE_LABELS[preview.source]}</span>
                        <span className="skill-preview-path">{preview.path}</span>
                      </div>
                      <pre>{preview.body}</pre>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
        {missing.map((id) => (
          <div key={id} className="skill-option is-missing">
            <span className="skill-option-copy">
              <span className="skill-name">{id}</span>
              <span className="skill-note">This skill is no longer installed.</span>
            </span>
            <button type="button" className="text-button" disabled={disabled} onClick={() => onToggle(id, false)}>
              Remove
            </button>
          </div>
        ))}
        {!catalogLoaded && !catalogNote ? <span className="field-note">Loading skills…</span> : null}
        {catalogLoaded && catalog.length === 0 && skillIds.length === 0 ? (
          <span className="field-note">
            No skills installed. Add a SKILL.md under skills/, .github/skills, or your Copilot skills folder.
          </span>
        ) : null}
      </div>
      {warnings.length > 0 ? (
        <div className="skill-warnings">
          <span className="field-note">Some skill files were skipped:</span>
          <ul>
            {warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {catalogNote ? <span className="field-note">{catalogNote}</span> : null}
      {selectedChars > 0 ? (
        <span className={overBudget ? "field-note skill-warning-note" : "field-note"}>
          Selected: {formatCount(selectedChars)} / {formatCount(MAX_SKILLS_CHARS)} chars
          {overBudget ? " — later skills will be truncated or omitted." : ""}
        </span>
      ) : null}
      {limitReached ? (
        <span className="field-note">{`Up to ${MAX_SKILLS} skills per agent. Clear one to add another.`}</span>
      ) : null}
      <span className="field-note">
        Checked skills are sent on every message for this agent. Other agents do not receive them.
      </span>
      <div className="skill-actions">
        <button type="button" className="text-button" disabled={disabled} onClick={refresh}>
          Refresh
        </button>
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            void fid()
              .skills.openFolder()
              .catch((caught: unknown) => onError(errorText(caught)));
          }}
        >
          Open skills folder
        </button>
      </div>
      <span className="field-note">
        Workspace and Copilot skills are files on this PC. Open a skill to read it before checking it.
      </span>
    </div>
  );
}
