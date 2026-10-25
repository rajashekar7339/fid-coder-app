import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  GitBranch,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import type { SettingsView } from "../../shared/types";
import { errorText, fid } from "../fid";
import { Modal } from "./Modal";

export type SignInNote = { tone: "progress" | "ok" | "error"; text: string };
export type SettingsSection = "copilot" | "github" | "jira";

type Props = {
  settings: SettingsView | null;
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
    subtitle: "The site and API token used by Jira agents.",
    Icon: Ticket,
  },
];

export function SettingsDialog({
  settings,
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]!;

  useEffect(() => {
    if (!jiraSiteDirty && settings) setJiraSite(settings.jiraSiteUrl);
  }, [settings, jiraSiteDirty]);

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
            {SECTIONS.map((item) => {
              const Icon = item.Icon;
              const connected =
                item.id === "copilot"
                  ? Boolean(settings?.signedIn)
                  : item.id === "github"
                    ? Boolean(settings?.hasGithubPat)
                    : Boolean(settings?.hasJiraToken || settings?.jiraSiteUrl);
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
          <div className="settings-nav-foot">Credentials stay on this machine.</div>
        </nav>

        <div className="settings-main">
          <div className="settings-scroll">
            <h1 className="settings-heading">{current.title}</h1>
            <p className="settings-sub">{current.subtitle}</p>

            {section === "copilot" ? (
              <CopilotSection
                settings={settings}
                checkingSignIn={checkingSignIn}
                busy={busy}
                onStartSignIn={onStartSignIn}
                onSignOut={() => void signOut()}
                onRecheck={() => void recheck()}
                onSectionChange={onSectionChange}
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
                  }, jiraSite.trim() ? "Jira site saved." : "Jira site removed.")
                }
                onSaveToken={() =>
                  void run(async () => {
                    await fid().settings.saveJiraToken(jiraToken);
                    setJiraToken("");
                  }, "Jira token saved.")
                }
                onClearToken={() => void run(() => fid().settings.clearJiraToken(), "Jira token removed.")}
              />
            ) : null}

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
              <Lock size={12} aria-hidden="true" />
              <span>Tokens are encrypted with Windows and never leave this machine.</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CopilotSection({
  settings,
  checkingSignIn,
  busy,
  onStartSignIn,
  onSignOut,
  onRecheck,
  onSectionChange,
}: {
  settings: SettingsView | null;
  checkingSignIn: boolean;
  busy: boolean;
  onStartSignIn: () => void;
  onSignOut: () => void;
  onRecheck: () => void;
  onSectionChange: (section: SettingsSection) => void;
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

      <div className="settings-section-title">
        Agent connections <span />
      </div>
      <div className="integration-grid">
        <IntegrationCard
          connected={Boolean(settings?.hasGithubPat)}
          icon={<GitBranch size={13} aria-hidden="true" />}
          name="GitHub"
          description="Token for pull requests and repository access."
          onManage={() => onSectionChange("github")}
        />
        <IntegrationCard
          connected={Boolean(settings?.hasJiraToken || settings?.jiraSiteUrl)}
          icon={<Ticket size={13} aria-hidden="true" />}
          name="Jira"
          description="Site URL and API token for Jira agents."
          onManage={() => onSectionChange("jira")}
        />
      </div>
    </>
  );
}

function IntegrationCard({
  connected,
  icon,
  name,
  description,
  onManage,
}: {
  connected: boolean;
  icon: ReactNode;
  name: string;
  description: string;
  onManage: () => void;
}) {
  return (
    <div className="integration-card">
      <div className="integration-head">
        <span className={`integration-icon ${name === "GitHub" ? "is-git" : ""}`}>{icon}</span>
        <span className="integration-name">{name}</span>
        <span className={`integration-state ${connected ? "is-on" : ""}`}>
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p>{description}</p>
      <div className="integration-foot">
        <button type="button" className="text-button" onClick={onManage}>
          Manage
        </button>
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
          <div className="connection-note">Site URL and API token for Jira agents.</div>
        </div>
        <span className={`connection-badge ${hasToken || site ? "is-on" : ""}`}>
          {hasToken || site ? "Configured" : "Not configured"}
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
        </div>
        <label className="field">
          <span className="field-label">API token</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={token}
            placeholder={hasToken ? "Token saved — paste a new one to replace" : "Atlassian API token"}
            onChange={(event) => onToken(event.target.value)}
          />
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
      </div>
    </div>
  );
}
