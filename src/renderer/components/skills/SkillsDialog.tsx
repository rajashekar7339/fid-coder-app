import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, Upload, Wrench, X } from "lucide-react";
import { MAX_SKILL_CHARS, skillVersionLabel, SKILL_SOURCE_LABELS } from "../../../shared/skills";
import type { SkillCatalog, SkillContent, SkillInfo, SkillSource } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatBytes, formatCount } from "../../lib/format";
import { Modal } from "../ui/Modal";

type Props = {
  workspaceDir: string | null;
  hasAgent: boolean;
  onClose: () => void;
  onUse: (id: string) => void;
  onChanged: () => void;
};

const SOURCE_ORDER: SkillSource[] = ["app", "workspace", "copilot", "builtin"];

export function SkillsDialog({ workspaceDir, hasAgent, onClose, onUse, onChanged }: Props) {
  const [catalog, setCatalog] = useState<SkillCatalog>({ skills: [], warnings: [] });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<SkillContent | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const previewRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setOpenKey(null);
    setPreview(null);
    setPreviewNote(null);
    setPreviewState("idle");
    void fid()
      .skills.list(workspaceDir)
      .then((next) => {
        if (cancelled) return;
        setCatalog(next);
        setState("ready");
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setState("error");
        setNotice({ tone: "error", text: errorText(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceDir, refresh]);

  const groups = SOURCE_ORDER.map((source) => ({
    source,
    skills: catalog.skills.filter((skill) => skill.source === source),
  })).filter((group) => group.skills.length > 0);

  async function toggleRead(skill: SkillInfo) {
    const key = `${skill.source}:${skill.id}`;
    if (openKey === key) {
      previewRequest.current += 1;
      setOpenKey(null);
      setPreview(null);
      setPreviewNote(null);
      setPreviewState("idle");
      return;
    }
    const request = ++previewRequest.current;
    setOpenKey(key);
    setPreview(null);
    setPreviewNote(null);
    setPreviewState("loading");
    try {
      const content = await fid().skills.read(workspaceDir, skill.id, skill.source);
      if (previewRequest.current !== request) return;
      setPreview(content);
      setPreviewState(content ? "ready" : "idle");
      if (!content) setPreviewNote("The skill file could not be found.");
    } catch (caught) {
      if (previewRequest.current !== request) return;
      setPreviewState("error");
      setPreviewNote(errorText(caught));
    }
  }

  function refreshSkills() {
    setNotice(null);
    setRefresh((value) => value + 1);
    onChanged();
  }

  async function upload() {
    if (uploading) return;
    setUploading(true);
    setNotice(null);
    try {
      const result = await fid().skills.install();
      if (result.status === "installed") {
        const current = skillVersionLabel(result.skill.version);
        const text = result.previous
          ? result.previous.version === result.skill.version
            ? `Replaced ${result.skill.name}; the version stays ${current}.`
            : `Updated ${result.skill.name}: ${skillVersionLabel(result.previous.version)} → ${current}.`
          : `Added ${result.skill.name} ${current}.`;
        setNotice({ tone: "ok", text });
        setRefresh((value) => value + 1);
        onChanged();
      }
    } catch (caught) {
      setNotice({ tone: "error", text: errorText(caught) });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal label="Skills" className="skills-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Library</div>
          <div className="modal-title">Skills</div>
        </div>
        <div className="skills-head-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh skills"
            title="Reload skills"
            disabled={uploading || state === "loading"}
            onClick={refreshSkills}
          >
            <RefreshCw size={14} className={state === "loading" ? "spin" : undefined} />
          </button>
          <button type="button" className="btn btn-primary" disabled={uploading} onClick={() => void upload()}>
            <Upload size={13} />
            {uploading ? "Uploading…" : "Upload skill"}
          </button>
          <button type="button" className="icon-button" aria-label="Close skills" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="skills-body">
        {notice ? (
          <p
            className={`skills-notice ${notice.tone === "error" ? "is-error" : ""}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        ) : null}

        {state === "loading" && catalog.skills.length === 0 ? (
          <p className="skills-empty">Reading skills…</p>
        ) : state === "error" ? (
          <p className="skills-empty">Skills could not be loaded.</p>
        ) : catalog.skills.length === 0 ? (
          <div className="skills-empty-state">
            <Wrench size={18} aria-hidden="true" />
            <strong>No skills installed</strong>
            <span>Upload a folder with a SKILL.md.</span>
            <button type="button" className="btn btn-primary" disabled={uploading} onClick={() => void upload()}>
              <Upload size={13} />
              Upload skill
            </button>
          </div>
        ) : (
          groups.map((group) => (
            <div className="skills-group" key={group.source}>
              <div className="skills-group-head">
                <span>{SKILL_SOURCE_LABELS[group.source]}</span>
                <span>{group.skills.length}</span>
              </div>
              {group.skills.map((skill) => {
                const key = `${skill.source}:${skill.id}`;
                const open = openKey === key;
                const readerId = `skill-reader-${skill.source}-${skill.id}`;
                return (
                  <div className={`skill-card ${open ? "is-open" : ""}`} key={key}>
                    <div className="skill-card-row">
                      <button
                        type="button"
                        className="skill-card-copy"
                        aria-expanded={open}
                        aria-controls={readerId}
                        onClick={() => void toggleRead(skill)}
                      >
                        <span className="skill-card-title">
                          <span className="skill-name">{skill.name}</span>
                          <span className="skill-card-id">{skill.id}</span>
                          <ChevronDown size={12} className="skill-card-chevron" aria-hidden="true" />
                        </span>
                        <span className="skill-note">{skill.description}</span>
                        <span className="skill-meta">
                          <span>{SKILL_SOURCE_LABELS[skill.source]}</span>
                          <span>{skillVersionLabel(skill.version)}</span>
                          <span>{formatCount(skill.chars)} chars</span>
                          {skill.chars > MAX_SKILL_CHARS ? (
                            <span className="skill-warning">will be truncated</span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary skill-card-use"
                        disabled={!hasAgent}
                        title={hasAgent ? `Use ${skill.name} in chat` : "Select an agent first"}
                        onClick={() => onUse(skill.id)}
                      >
                        Use
                      </button>
                    </div>
                    {open ? (
                      <div className="skill-reader" id={readerId}>
                        {previewState === "loading" ? <span className="field-note">Loading…</span> : null}
                        {previewNote ? <span className="field-note">{previewNote}</span> : null}
                        {preview ? (
                          <>
                            <div className="skill-reader-head">
                              <span>{SKILL_SOURCE_LABELS[preview.source]}</span>
                              <span>{skillVersionLabel(preview.version)}</span>
                              <span className="skill-reader-path">{preview.path}</span>
                            </div>
                            <pre>{preview.body}</pre>
                            {preview.files.length > 0 ? (
                              <div className="skill-reader-files">
                                <span className="skill-reader-files-head">
                                  Supporting files · {preview.files.length}
                                </span>
                                <ul>
                                  {preview.files.map((file) => (
                                    <li key={file.path}>
                                      <span className="skill-reader-file-path">{file.path}</span>
                                      <span>{formatBytes(file.bytes)}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))
        )}

        {catalog.warnings.length > 0 ? (
          <details className="skill-warnings">
            <summary>
              {catalog.warnings.length} skill file{catalog.warnings.length === 1 ? "" : "s"} skipped or hidden
            </summary>
            <ul>
              {catalog.warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <p className="skills-trust">
          Skills are instructions. Read the SKILL.md before you use one with <code>/skills &lt;skill&gt; &lt;task&gt;</code>.
        </p>
      </div>
    </Modal>
  );
}
