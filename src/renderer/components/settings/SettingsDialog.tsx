import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  BookOpen,
  Check,
  Gauge,
  GitBranch,
  KeyRound,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Power,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { BUILT_IN_APPROVAL_RULES } from "../../../shared/approval";
import { formatUsageCount, formatUsageReset, type CopilotUsageView } from "../../../shared/copilot-usage";
import type { AppPresence } from "../../../shared/app-settings";
import type { Agent, ApprovalMatcher, ApprovalRule, SettingsView } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";
import { UsageBar, usageLevel } from "../ui/UsageBar";

export type SignInNote = { tone: "progress" | "ok" | "error"; text: string };
export type SettingsSection =
  | "copilot"
  | "github"
  | "jira"
  | "confluence"
  | "datadog"
  | "safety"
  | "app";

type Props = {
  agents: Agent[];
  settings: SettingsView | null;
  usage: CopilotUsageView | null;
  usageMessage: string | null;
  usageLoading: boolean;
  onRefreshUsage: (force?: boolean) => Promise<void>;
  section: SettingsSection;
  checkingSignIn: boolean;
  signInNote: SignInNote | null;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onStartSignIn: () => void;
  onSignOut: () => Promise<SettingsView>;
  onSaved: () => void;
  onRefresh: () => Promise<SettingsView>;
};

const SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  title: string;
  subtitle: string;
  Icon: typeof Sparkles;
}> = [
  {
    id: "copilot",
    label: "Copilot",
    title: "GitHub Copilot",
    subtitle: "The account your agents use to think and call tools.",
    Icon: Sparkles,
  },
  {
    id: "github",
    label: "GitHub",
    title: "GitHub",
    subtitle: "A personal access token for pull requests and repository work.",
    Icon: GitBranch,
  },
  {
    id: "jira",
    label: "Jira",
    title: "Jira",
    subtitle: "The site and personal access token used to read Jira. Without both, agents use the browser.",
    Icon: Ticket,
  },
  {
    id: "confluence",
    label: "Confluence",
    title: "Confluence",
    subtitle: "The site and token used to search, read, and update Confluence pages.",
    Icon: BookOpen,
  },
  {
    id: "datadog",
    label: "Datadog",
    title: "Datadog",
    subtitle: "The Datadog URL the analyst opens in the logged-in browser. No API key is needed.",
    Icon: Activity,
  },
  {
    id: "safety",
    label: "Safety",
    title: "Approval rules",
    subtitle: "Saved allow and deny rules for sensitive shell commands. Deny rules always win.",
    Icon: ShieldCheck,
  },
  {
    id: "app",
    label: "This PC",
    title: "This PC",
    subtitle: "Pause scheduled work. Closing Fid Coder stops routines.",
    Icon: Power,
  },
];

const ACCOUNT_SECTIONS = SECTIONS.filter((item) => item.id !== "safety" && item.id !== "app");
const SAFETY_SECTION = SECTIONS.find((item) => item.id === "safety")!;
const APP_SECTION = SECTIONS.find((item) => item.id === "app")!;

function sectionConnected(id: SettingsSection, settings: SettingsView | null): boolean {
  switch (id) {
    case "copilot":
      return Boolean(settings?.signedIn);
    case "github":
      return Boolean(settings?.hasGithubPat);
    case "jira":
      return Boolean(settings?.hasJiraToken && settings?.jiraSiteUrl);
    case "confluence":
      return Boolean(
        settings?.hasConfluenceToken &&
          settings?.confluenceSiteUrl &&
          (settings.confluenceMode !== "cloud" || settings.confluenceEmail),
      );
    case "datadog":
      return Boolean(settings?.datadogUrl);
    default:
      return false;
  }
}

export function SettingsDialog({
  agents,
  settings,
  usage,
  usageMessage,
  usageLoading,
  onRefreshUsage,
  section,
  checkingSignIn,
  signInNote,
  onSectionChange,
  onClose,
  onStartSignIn,
  onSignOut,
  onSaved,
  onRefresh,
}: Props) {
  const [githubPat, setGithubPat] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraSite, setJiraSite] = useState("");
  const [jiraSiteDirty, setJiraSiteDirty] = useState(false);
  const [confluenceToken, setConfluenceToken] = useState("");
  const [confluenceSite, setConfluenceSite] = useState("");
  const [confluenceEmail, setConfluenceEmail] = useState("");
  const [confluenceMode, setConfluenceMode] = useState<"cloud" | "data-center">("data-center");
  const [confluenceDirty, setConfluenceDirty] = useState(false);
  const [datadogUrl, setDatadogUrl] = useState("");
  const [datadogDirty, setDatadogDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  useEffect(() => {
    if (!jiraSiteDirty && settings) setJiraSite(settings.jiraSiteUrl);
  }, [settings, jiraSiteDirty]);

  useEffect(() => {
    if (!confluenceDirty && settings) {
      setConfluenceSite(settings.confluenceSiteUrl);
      setConfluenceEmail(settings.confluenceEmail);
      setConfluenceMode(settings.confluenceMode);
    }
  }, [settings, confluenceDirty]);

  useEffect(() => {
    if (!datadogDirty && settings) {
      setDatadogUrl(settings.datadogUrl);
    }
  }, [settings, datadogDirty]);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [section]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      onSaved();
      setMessage(success);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await onSignOut();
      setMessage("Signed out of Copilot.");
    } catch (caught) {
      setError(errorText(caught));
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function recheck() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await onRefresh();
      await onRefreshUsage(true);
      setMessage("Connection refreshed.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal label="Settings" className="settings-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Fid Coder</div>
          <div className="modal-title">Settings</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="settings-body">
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-nav-head">Account</div>
          <div className="settings-nav-list">
            {ACCOUNT_SECTIONS.map((item) => {
              const Icon = item.Icon;
              const connected = sectionConnected(item.id, settings);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${item.id === section ? "is-active" : ""}`}
                  onClick={() => onSectionChange(item.id)}
                >
                  <Icon size={14} aria-hidden="true" />
                  {item.label}
                  <span className={`nav-status ${connected ? "is-on" : ""}`} />
                </button>
              );
            })}
          </div>
          <div className="settings-nav-head settings-nav-head-spaced">Safety</div>
          <div className="settings-nav-list">
            <button
              type="button"
              className={`settings-nav-item ${section === "safety" ? "is-active" : ""}`}
              onClick={() => onSectionChange("safety")}
            >
              <SAFETY_SECTION.Icon size={14} aria-hidden="true" />
              {SAFETY_SECTION.label}
            </button>
          </div>
          <div className="settings-nav-head settings-nav-head-spaced">This PC</div>
          <div className="settings-nav-list">
            <button
              type="button"
              className={`settings-nav-item ${section === "app" ? "is-active" : ""}`}
              onClick={() => onSectionChange("app")}
            >
              <APP_SECTION.Icon size={14} aria-hidden="true" />
              {APP_SECTION.label}
            </button>
          </div>
          <div className="settings-nav-foot">Credentials stay on this machine.</div>
        </nav>

        <div className="settings-main">
          <div className="settings-scroll">
            <h1 className="settings-heading">{current.title}</h1>
            <p className="settings-sub">{current.subtitle}</p>

            {section === "copilot" ? (
              <CopilotSection
                settings={settings}
                usage={usage}
                usageMessage={usageMessage}
                usageLoading={usageLoading}
                onRefreshUsage={onRefreshUsage}
                checkingSignIn={checkingSignIn}
                busy={busy}
                onStartSignIn={onStartSignIn}
                onSignOut={() => void signOut()}
                onRecheck={() => void recheck()}
              />
            ) : null}

            {section === "github" ? (
              <GitHubSection
                hasToken={settings?.hasGithubPat ?? false}
                value={githubPat}
                busy={busy}
                onChange={setGithubPat}
                onSave={() =>
                  void run(async () => {
                    await fid().settings.saveGithubPat(githubPat);
                    setGithubPat("");
                  }, "GitHub token saved.")
                }
                onClear={() => void run(() => fid().settings.clearGithubPat(), "GitHub token removed.")}
              />
            ) : null}

            {section === "app" ? (
              <AppSection
                settings={settings}
                busy={busy}
                onChange={async (patch) => {
                  await fid().app.setPresence(patch);
                  await onRefresh();
                }}
              />
            ) : null}

            {section === "jira" ? (
              <JiraSection
                hasToken={settings?.hasJiraToken ?? false}
                site={jiraSite}
                token={jiraToken}
                busy={busy}
                onSite={(value) => {
                  setJiraSiteDirty(true);
                  setJiraSite(value);
                }}
                onToken={setJiraToken}
                onSaveSite={() =>
                  void run(async () => {
                    await fid().settings.saveJiraSite(jiraSite);
                    setJiraSiteDirty(false);
                  }, jiraSite.trim()
                    ? settings?.hasJiraToken
                      ? "Jira site saved."
                      : "Jira site saved. Add a token to enable Jira tools."
                    : "Jira site removed.")
                }
                onSaveToken={() =>
                  void run(async () => {
                    await fid().settings.saveJiraToken(jiraToken);
                    setJiraToken("");
                  }, settings?.jiraSiteUrl || jiraSite.trim()
                    ? "Jira token saved."
                    : "Jira token saved. Add the site URL to enable Jira tools.")
                }
                onClearToken={() =>
                  void run(async () => {
                    await fid().settings.clearJiraToken();
                  }, "Jira token removed. Jira tools are disabled.")
                }
              />
            ) : null}

            {section === "confluence" ? (
              <ConfluenceSection
                hasToken={settings?.hasConfluenceToken ?? false}
                site={confluenceSite}
                email={confluenceEmail}
                mode={confluenceMode}
                token={confluenceToken}
                busy={busy}
                onSite={(value) => {
                  setConfluenceDirty(true);
                  setConfluenceSite(value);
                }}
                onEmail={(value) => {
                  setConfluenceDirty(true);
                  setConfluenceEmail(value);
                }}
                onMode={(value) => {
                  setConfluenceDirty(true);
                  setConfluenceMode(value);
                }}
                onToken={setConfluenceToken}
                onSaveSettings={() =>
                  void run(async () => {
                    await fid().settings.saveConfluence({
                      siteUrl: confluenceSite,
                      email: confluenceEmail,
                      mode: confluenceMode,
                    });
                    setConfluenceDirty(false);
                  }, confluenceSite.trim()
                    ? settings?.hasConfluenceToken
                      ? "Confluence settings saved."
                      : "Confluence settings saved. Add a token to enable the tools."
                    : "Confluence site removed.")
                }
                onSaveToken={() =>
                  void run(async () => {
                    await fid().settings.saveConfluenceToken(confluenceToken);
                    setConfluenceToken("");
                  }, "Confluence token saved.")
                }
                onClearToken={() =>
                  void run(async () => {
                    await fid().settings.clearConfluenceToken();
                  }, "Confluence token removed. Confluence tools are disabled.")
                }
              />
            ) : null}

            {section === "datadog" ? (
              <DatadogSection
                url={datadogUrl}
                busy={busy}
                onUrl={(value) => {
                  setDatadogDirty(true);
                  setDatadogUrl(value);
                }}
                onSaveSettings={() =>
                  void run(async () => {
                    await fid().settings.saveDatadog({ url: datadogUrl });
                    setDatadogDirty(false);
                  }, datadogUrl.trim()
                    ? "Datadog URL saved. The analyst now uses the local browser."
                    : "Datadog URL removed.")
                }
              />
            ) : null}

            {section === "safety" ? <SafetySection agents={agents} /> : null}

            {message ? (
              <p className="settings-message is-success" role="status">
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="settings-message is-error" role="alert">
                {error}
              </p>
            ) : null}
            {section === "copilot" && signInNote ? (
              <p className={`settings-message is-${signInNote.tone === "ok" ? "success" : signInNote.tone === "error" ? "error" : "muted"}`}>
                {signInNote.text}
              </p>
            ) : null}

            <div className="security-note">
              {section === "safety" ? (
                <>
                  <ShieldCheck size={12} aria-hidden="true" />
                  <span>Rules stay in the local database. Delete a rule to ask again on the next command.</span>
                </>
              ) : section === "datadog" ? (
                <>
                  <Lock size={12} aria-hidden="true" />
                  <span>The Datadog session stays in the browser; no API key is stored.</span>
                </>
              ) : (
                <>
                  <Lock size={12} aria-hidden="true" />
                  <span>Tokens are encrypted with Windows and never leave this machine.</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CopilotSection({
  settings,
  usage,
  usageMessage,
  usageLoading,
  onRefreshUsage,
  checkingSignIn,
  busy,
  onStartSignIn,
  onSignOut,
  onRecheck,
}: {
  settings: SettingsView | null;
  usage: CopilotUsageView | null;
  usageMessage: string | null;
  usageLoading: boolean;
  onRefreshUsage: (force?: boolean) => Promise<void>;
  checkingSignIn: boolean;
  busy: boolean;
  onStartSignIn: () => void;
  onSignOut: () => void;
  onRecheck: () => void;
}) {
  const signedIn = Boolean(settings?.signedIn);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  useEffect(() => {
    if (!signedIn) setConfirmSignOut(false);
  }, [signedIn]);

  return (
    <>
      <div className="connection-card">
        <div className="connection-head">
          <div className="connection-icon">
            <Sparkles size={16} aria-hidden="true" />
          </div>
          <div className="connection-copy">
            <div className="connection-name">Copilot account</div>
            <div className="connection-note">
              {!signedIn
                ? "Sign in to use Copilot with your agents"
                : settings?.hasStoredToken
                  ? "Using a Copilot token saved on this machine"
                  : "Signed in through the local GitHub Copilot CLI"}
            </div>
          </div>
          <span className={`connection-badge ${signedIn ? "is-on" : ""}`}>
            {signedIn ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="connection-grid">
          <div className="connection-cell">
            <span>Account</span>
            <strong>{settings?.loginName || "Not signed in"}</strong>
          </div>
          <div className="connection-cell">
            <span>CLI</span>
            <strong>
              {settings?.cliFound ? (
                <Check size={12} className="inline-check" aria-hidden="true" />
              ) : null}
              {settings?.cliVersion || (settings?.cliFound ? "Available" : "Not found")}
            </strong>
          </div>
        </div>
        <div className={`connection-actions ${confirmSignOut ? "is-confirming" : ""}`}>
          {confirmSignOut ? (
            <>
              <span className="inline-confirm-copy">
                Sign out of Copilot? The next chat will need to sign in again.
              </span>
              <span className="footer-spacer" />
              <button
                type="button"
                className="btn btn-quiet"
                autoFocus
                disabled={busy}
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={busy}
                onClick={() => {
                  setConfirmSignOut(false);
                  onSignOut();
                }}
              >
                <LogOut size={12} aria-hidden="true" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <button type="button" className="text-button" disabled={busy} onClick={onRecheck}>
                <RefreshCw size={11} />
                Re-check
              </button>
              <span className="footer-spacer" />
              {signedIn ? (
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  disabled={busy}
                  onClick={() => setConfirmSignOut(true)}
                >
                  <LogOut size={12} aria-hidden="true" />
                  Sign out
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || checkingSignIn}
                  onClick={onStartSignIn}
                >
                  {checkingSignIn ? "Checking sign-in…" : "Sign in with Copilot"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!signedIn && settings ? <p className="settings-inline-note">{settings.authStatus}</p> : null}

      {signedIn ? (
        <UsageCard usage={usage} message={usageMessage} loading={usageLoading} onRefresh={onRefreshUsage} />
      ) : null}
    </>
  );
}

function UsageCard({
  usage,
  message,
  loading,
  onRefresh,
}: {
  usage: CopilotUsageView | null;
  message: string | null;
  loading: boolean;
  onRefresh: (force?: boolean) => Promise<void>;
}) {
  const percent = usage?.usedPercent ?? null;
  const level = usageLevel(percent, usage?.blocked ?? false);
  const reset = formatUsageReset(usage?.resetsAt);
  const note = usage?.blocked
    ? reset
      ? `No ${usage.label.toLowerCase()} left. Chats will fail until ${reset}.`
      : `No ${usage.label.toLowerCase()} left.`
    : null;

  return (
    <div className="connection-card usage-card">
      <div className="connection-head">
        <div className="connection-icon usage-icon">
          <Gauge size={16} aria-hidden="true" />
        </div>
        <div className="connection-copy">
          <div className="connection-name">Copilot usage</div>
          <div className="connection-note">{usage ? usage.label : "Included with this account"}</div>
        </div>
        <button type="button" className="text-button" disabled={loading} onClick={() => void onRefresh(true)}>
          <RefreshCw size={11} className={loading ? "spin" : undefined} aria-hidden="true" />
          Refresh
        </button>
      </div>
      <div className="usage-body">
        {usage === null ? (
          <p className="usage-note is-muted">{message ?? "Reading usage…"}</p>
        ) : usage.unlimited ? (
          <div className="usage-figures">
            <strong>Unlimited</strong>
            <span>
              {formatUsageCount(usage.used)} {usage.label.toLowerCase()} used
            </span>
          </div>
        ) : (
          <>
            <div className="usage-figures">
              {usage.included !== null ? (
                <>
                  <strong>{formatUsageCount(usage.used)}</strong>
                  <span>of {formatUsageCount(usage.included)} used</span>
                </>
              ) : (
                <>
                  <strong>{formatUsageCount(usage.used)}</strong>
                  <span>{usage.label.toLowerCase()} used</span>
                </>
              )}
            </div>
            {percent !== null ? (
              <div className="usage-bar-row">
                <UsageBar
                  percent={percent}
                  blocked={usage.blocked}
                  label={`${usage.label}: ${formatUsageCount(percent)}% used`}
                />
                <span className={`usage-percent is-${level}`}>{formatUsageCount(percent)}%</span>
              </div>
            ) : null}
            <div className="usage-meta">
              {usage.remaining !== null ? (
                <span>
                  <strong>{formatUsageCount(usage.remaining)}</strong> left
                </span>
              ) : null}
              {reset ? (
                <span>
                  Resets <strong>{reset}</strong>
                </span>
              ) : null}
              {usage.overage > 0 ? (
                <span className="usage-overage">+{formatUsageCount(usage.overage)} over</span>
              ) : null}
            </div>
            {note ? <p className="usage-note is-danger">{note}</p> : null}
            {message && !note ? <p className="usage-note is-muted">{message}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}

function GitHubSection({
  hasToken,
  value,
  busy,
  onChange,
  onSave,
  onClear,
}: {
  hasToken: boolean;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="connection-card">
        <div className="connection-head">
          <div className="connection-icon is-git">
            <GitBranch size={16} aria-hidden="true" />
          </div>
          <div className="connection-copy">
            <div className="connection-name">GitHub access</div>
            <div className="connection-note">Used by Git and pull request agents through the local shell.</div>
          </div>
          <span className={`connection-badge ${hasToken ? "is-on" : ""}`}>
            {hasToken ? "Token saved" : "No token"}
          </span>
        </div>
        <div className="settings-form">
          <label className="field">
            <span className="field-label">Personal access token</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={value}
              placeholder={hasToken ? "Token saved — paste a new one to replace" : "ghp_…"}
              onChange={(event) => onChange(event.target.value)}
            />
          </label>
          <div className="field-actions">
            <button type="button" className="btn btn-secondary" disabled={busy || !value.trim()} onClick={onSave}>
              <KeyRound size={12} />
              Save token
            </button>
            {hasToken ? (
              <button type="button" className="text-button is-danger" disabled={busy} onClick={onClear}>
                Remove token
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}

function SafetySection({ agents }: { agents: Agent[] }) {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState("");
  const [decision, setDecision] = useState<"allow" | "deny">("deny");
  const [command, setCommand] = useState("");
  const [matcher, setMatcher] = useState<ApprovalMatcher>("exact");
  const [folder, setFolder] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const editing = editingId ? rules.find((rule) => rule.id === editingId) ?? null : null;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRules(await fid().approvals.rules());
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openForm(rule: ApprovalRule | null) {
    setFormOpen(true);
    setEditingId(rule?.id ?? null);
    setAgentId(rule?.agentId ?? "");
    setDecision(rule?.decision ?? "deny");
    setCommand(rule?.match ?? "");
    setMatcher(rule?.matcher ?? "exact");
    setFolder(rule?.cwd ?? "");
    setFormError(null);
  }

  function cancelForm() {
    setFormOpen(false);
    setEditingId(null);
    setFormError(null);
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const text = command.trim();
    if (!text) {
      setFormError("Enter a command or prefix.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const approvals = fid().approvals;
      const input = {
        agentId: agentId || null,
        kind: editing?.kind ?? "shell",
        decision,
        match: text,
        matcher,
        cwd: folder.trim(),
      };
      if (editing) await approvals.updateRule(editing.id, input);
      else await approvals.createRule(input);
      setFormOpen(false);
      setEditingId(null);
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      setSaving(false);
    }
  }

  async function remove(rule: ApprovalRule) {
    setDeleting(rule.id);
    setError(null);
    try {
      await fid().approvals.deleteRule(rule.id);
      setRules((current) => current.filter((item) => item.id !== rule.id));
      if (editingId === rule.id) cancelForm();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="connection-card">
      <div className="connection-head">
        <div className="connection-icon is-safety">
          <ShieldCheck size={16} aria-hidden="true" />
        </div>
        <div className="connection-copy">
          <div className="connection-name">Approval rules</div>
          <div className="connection-note">
            Built-in denies always apply. Saved rules are checked next, but only when a command asks for approval.
            Deny rules win over allow rules.
          </div>
        </div>
        <div className="connection-head-actions">
          <button type="button" className="text-button" disabled={saving} onClick={() => openForm(null)}>
            <Plus size={11} aria-hidden="true" />
            New rule
          </button>
          <button type="button" className="text-button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={11} className={loading ? "spin" : undefined} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="safety-body">
        <div className="approval-rule-list">
          {BUILT_IN_APPROVAL_RULES.map((rule) => (
            <div className="approval-rule is-built-in" key={rule.id} title={rule.detail}>
              <span className="approval-decision is-deny">deny</span>
              <div className="approval-rule-copy">
                <code>{rule.match}</code>
                <span>
                  {rule.label} · Built-in · {rule.matcher === "prefix" ? "Starts with" : "Exact forms"} · Always
                  denied
                </span>
                <span className="approval-rule-detail">{rule.detail}</span>
              </div>
              <Lock size={11} className="approval-rule-lock" aria-hidden="true" />
            </div>
          ))}
        </div>

        {formOpen ? (
          <form className="approval-rule-form" onSubmit={saveRule}>
            <div className="approval-form-title">{editing ? "Edit rule" : "New rule"}</div>
            <div className="approval-form-grid">
              <label className="field">
                <span className="field-label">Agent</span>
                <select
                  className="input"
                  aria-label="Rule agent"
                  value={agentId}
                  disabled={saving}
                  onChange={(event) => setAgentId(event.target.value)}
                >
                  <option value="">All agents</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Decision</span>
                <select
                  className="input"
                  aria-label="Rule decision"
                  value={decision}
                  disabled={saving}
                  onChange={(event) => setDecision(event.target.value as "allow" | "deny")}
                >
                  <option value="deny">Always deny</option>
                  <option value="allow">Always allow</option>
                </select>
              </label>
              <label className="field approval-form-wide">
                <span className="field-label">Command</span>
                <input
                  className="input"
                  aria-label="Rule command"
                  value={command}
                  placeholder="git push --force"
                  autoFocus
                  disabled={saving}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Match</span>
                <select
                  className="input"
                  aria-label="Rule match"
                  value={matcher}
                  disabled={saving}
                  onChange={(event) => setMatcher(event.target.value as ApprovalMatcher)}
                >
                  <option value="exact">Exact command</option>
                  <option value="prefix">Starts with</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Folder</span>
                <input
                  className="input"
                  aria-label="Rule folder"
                  value={folder}
                  placeholder="Any folder"
                  title="Leave empty to apply in every folder."
                  disabled={saving}
                  onChange={(event) => setFolder(event.target.value)}
                />
              </label>
            </div>
            <div className="approval-form-actions">
              <button type="button" className="btn btn-quiet" disabled={saving} onClick={cancelForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-secondary" disabled={saving || !command.trim()}>
                {saving ? "Saving…" : editing ? "Save rule" : "Add rule"}
              </button>
            </div>
            {formError ? (
              <p className="settings-message is-error" role="alert">
                {formError}
              </p>
            ) : null}
          </form>
        ) : null}

        {loading ? (
          <p className="safety-empty">Reading saved rules…</p>
        ) : rules.length === 0 ? (
          <p className="safety-empty">
            No saved rules yet. Choose New rule, or choose Always allow or Always deny on an approval.
          </p>
        ) : (
          <div className="approval-rule-list">
            {rules.map((rule) => (
              <div className="approval-rule" key={rule.id}>
                <span className={`approval-decision is-${rule.decision}`}>{rule.decision}</span>
                <div className="approval-rule-copy">
                  <code>{rule.match}</code>
                  <span>
                    {rule.agentName} · {rule.cwd || "Any folder"}
                    {rule.matcher === "prefix" ? " · starts with" : ""}
                  </span>
                </div>
                <button
                  type="button"
                  className="desk-icon-button"
                  aria-label={`Edit ${rule.decision} rule for ${rule.match}`}
                  disabled={saving}
                  onClick={() => openForm(rule)}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="desk-icon-button"
                  aria-label={`Delete ${rule.decision} rule for ${rule.match}`}
                  disabled={deleting === rule.id}
                  onClick={() => void remove(rule)}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {error ? (
          <p className="settings-message is-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function JiraSection({
  hasToken,
  site,
  token,
  busy,
  onSite,
  onToken,
  onSaveSite,
  onSaveToken,
  onClearToken,
}: {
  hasToken: boolean;
  site: string;
  token: string;
  busy: boolean;
  onSite: (value: string) => void;
  onToken: (value: string) => void;
  onSaveSite: () => void;
  onSaveToken: () => void;
  onClearToken: () => void;
}) {
  return (
    <div className="connection-card">
      <div className="connection-head">
        <div className="connection-icon is-jira">
          <Ticket size={16} aria-hidden="true" />
        </div>
        <div className="connection-copy">
          <div className="connection-name">Jira access</div>
          <div className="connection-note">Site and personal access token. Without a token, agents use the browser.</div>
        </div>
        <span className={`connection-badge ${hasToken && site ? "is-on" : ""}`}>
          {hasToken && site ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="settings-form">
        <div className="field">
          <label className="field-label" htmlFor="jira-site">
            Site URL
          </label>
          <span className="field-inline">
            <input
              id="jira-site"
              className="input"
              value={site}
              placeholder="https://your-site.atlassian.net"
              onChange={(event) => onSite(event.target.value)}
            />
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onSaveSite}>
              Save site
            </button>
          </span>
          <span className="field-note">
            Use the Jira base URL. If Jira runs under a context path, include it, for example
            https://jira.example.com/jira.
          </span>
        </div>
        <label className="field">
          <span className="field-label">Personal access token</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={token}
            placeholder={hasToken ? "Token saved — paste a new one to replace" : "Jira personal access token"}
            onChange={(event) => onToken(event.target.value)}
          />
          <span className="field-note">
            Sent as a Bearer token. Use a Jira Data Center personal access token; Jira Cloud API tokens are not
            supported yet.
          </span>
        </label>
        <div className="field-actions">
          <button type="button" className="btn btn-secondary" disabled={busy || !token.trim()} onClick={onSaveToken}>
            <KeyRound size={12} />
            Save token
          </button>
          {hasToken ? (
            <button type="button" className="text-button is-danger" disabled={busy} onClick={onClearToken}>
              Remove token
            </button>
          ) : null}
        </div>
        <span className="field-note">
          Jira warnings are written to <code>logs\fid-coder.log</code> in the app data folder.
        </span>
      </div>
    </div>
  );
}

function ConfluenceSection({
  hasToken,
  site,
  email,
  mode,
  token,
  busy,
  onSite,
  onEmail,
  onMode,
  onToken,
  onSaveSettings,
  onSaveToken,
  onClearToken,
}: {
  hasToken: boolean;
  site: string;
  email: string;
  mode: "cloud" | "data-center";
  token: string;
  busy: boolean;
  onSite: (value: string) => void;
  onEmail: (value: string) => void;
  onMode: (value: "cloud" | "data-center") => void;
  onToken: (value: string) => void;
  onSaveSettings: () => void;
  onSaveToken: () => void;
  onClearToken: () => void;
}) {
  const configured = Boolean(hasToken && site.trim() && (mode !== "cloud" || email.trim()));
  return (
    <div className="connection-card">
      <div className="connection-head">
        <div className="connection-icon is-confluence">
          <BookOpen size={16} aria-hidden="true" />
        </div>
        <div className="connection-copy">
          <div className="connection-name">Confluence access</div>
          <div className="connection-note">Search, read, and update pages with a site token.</div>
        </div>
        <span className={`connection-badge ${configured ? "is-on" : ""}`}>
          {configured ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="settings-form">
        <label className="field">
          <span className="field-label">Deployment</span>
          <select
            className="select"
            value={mode}
            onChange={(event) => onMode(event.target.value === "cloud" ? "cloud" : "data-center")}
          >
            <option value="data-center">Data Center / Server</option>
            <option value="cloud">Cloud</option>
          </select>
          <span className="field-note">
            Cloud uses your Atlassian account email and an API token. Data Center uses a personal access token.
          </span>
        </label>
        <div className="field">
          <label className="field-label" htmlFor="confluence-site">
            Site URL
          </label>
          <input
            id="confluence-site"
            className="input"
            value={site}
            placeholder="https://confluence.example.com/confluence"
            onChange={(event) => onSite(event.target.value)}
          />
          <span className="field-note">
            {mode === "cloud"
              ? "Use the Cloud site, such as https://your-site.atlassian.net. /wiki is added for the API."
              : "Use the Confluence base URL. If it runs under a context path, include it."}
          </span>
        </div>
        {mode === "cloud" ? (
          <label className="field">
            <span className="field-label">Account email</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              placeholder="you@example.com"
              onChange={(event) => onEmail(event.target.value)}
            />
            <span className="field-note">The email address that owns the API token.</span>
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">
            {mode === "cloud" ? "API token" : "Personal access token"}
          </span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={token}
            placeholder={hasToken ? "Token saved — paste a new one to replace" : "Confluence token"}
            onChange={(event) => onToken(event.target.value)}
          />
          <span className="field-note">
            Stored with Windows encryption. The agent never sees the token. Updates always ask for approval.
          </span>
        </label>
        <div className="field-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onSaveSettings}>
            Save settings
          </button>
          <button type="button" className="btn btn-secondary" disabled={busy || !token.trim()} onClick={onSaveToken}>
            <KeyRound size={12} />
            Save token
          </button>
          {hasToken ? (
            <button type="button" className="text-button is-danger" disabled={busy} onClick={onClearToken}>
              Remove token
            </button>
          ) : null}
        </div>
        <span className="field-note">
          Confluence updates ask for approval and check the page version first, so a stale page is not overwritten.
        </span>
      </div>
    </div>
  );
}

function DatadogSection({
  url,
  busy,
  onUrl,
  onSaveSettings,
}: {
  url: string;
  busy: boolean;
  onUrl: (value: string) => void;
  onSaveSettings: () => void;
}) {
  const configured = Boolean(url.trim());
  return (
    <div className="connection-card">
      <div className="connection-head">
        <div className="connection-icon is-datadog">
          <Activity size={16} aria-hidden="true" />
        </div>
        <div className="connection-copy">
          <div className="connection-name">Datadog access</div>
          <div className="connection-note">
            Uses the logged-in local browser. No API key is needed.
          </div>
        </div>
        <span className={`connection-badge ${configured ? "is-on" : ""}`}>
          {configured ? "Browser" : "Not configured"}
        </span>
      </div>
      <div className="settings-form">
        <label className="field">
          <span className="field-label">Datadog URL</span>
          <input
            id="datadog-url"
            className="input"
            value={url}
            placeholder="https://app.datadoghq.com"
            onChange={(event) => onUrl(event.target.value)}
          />
          <span className="field-note">
            Paste the address you use for Datadog. A Log Explorer, monitor, or other deep link is trimmed to the
            site. Leave it empty and save to disconnect.
          </span>
        </label>
        <div className="field-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onSaveSettings}>
            Save URL
          </button>
        </div>
        <span className="field-note">
          The Datadog Analyst opens the Log Explorer in the local headed browser and captures the page's log
          response after you sign in once. The agent is read-only; the browser session stays in the browser and is
          never copied into a tool or the chat. Log text is sent to Copilot, so keep queries narrow and avoid
          secrets.
        </span>
      </div>
    </div>
  );
}

function AppSection({
  settings,
  busy,
  onChange,
}: {
  settings: SettingsView | null;
  busy: boolean;
  onChange: (patch: Partial<AppPresence>) => Promise<void>;
}) {
  return (
    <div className="settings-app">
      <div className="inline-row">
        <div className="inline-row-copy">
          <span>Pause all routines</span>
          <span>Scheduled runs wait until you resume them. Closing Fid Coder stops routines.</span>
        </div>
        <Switch
          checked={settings?.routinesPaused === true}
          disabled={busy}
          label="Pause all routines"
          onChange={(checked) => void onChange({ routinesPaused: checked })}
        />
      </div>
    </div>
  );
}
