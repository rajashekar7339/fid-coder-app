import { useEffect, useState } from "react";
import type { SettingsView as Settings } from "../../shared/types";
import { errorText, fid } from "../fid";
import { Dialog } from "./Dialog";

type SignInNote = { tone: "progress" | "ok" | "error"; text: string };
export type SettingsSection = "copilot" | "github" | "jira";

type Props = {
  settings: Settings | null;
  section: SettingsSection;
  checkingSignIn: boolean;
  signInNote: SignInNote | null;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onStartSignIn: () => void;
  onSignOut: () => Promise<Settings | null>;
  onSaved: () => void;
};

const SECTIONS: { id: SettingsSection; label: string; title: string }[] = [
  { id: "copilot", label: "Copilot", title: "GitHub Copilot" },
  { id: "github", label: "GitHub", title: "GitHub pull requests" },
  { id: "jira", label: "Jira", title: "Jira" },
];

export function SettingsView({
  settings,
  section,
  checkingSignIn,
  signInNote,
  onSectionChange,
  onClose,
  onStartSignIn,
  onSignOut,
  onSaved,
}: Props) {
  const [githubPat, setGithubPat] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraSite, setJiraSite] = useState("");
  const [jiraSiteDirty, setJiraSiteDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const current = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];

  useEffect(() => {
    if (!jiraSiteDirty && settings) setJiraSite(settings.jiraSiteUrl);
  }, [settings, jiraSiteDirty]);

  async function signOut() {
    setSigningOut(true);
    setError(null);
    setMessage(null);
    try {
      const next = await onSignOut();
      if (!next) return;
      setJiraSite(next.jiraSiteUrl);
      setJiraSiteDirty(false);
      setMessage(next.signedIn ? `Still signed in. ${next.authStatus}` : "Signed out of Copilot.");
    } catch (caught) {
      setError(errorText(caught));
      onSaved();
    } finally {
      setSigningOut(false);
    }
  }

  async function run(action: () => Promise<void>, ok: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      onSaved();
      setMessage(ok);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <Dialog title="Settings" width="max-w-3xl" onClose={onClose}>
      <div className="flex min-h-[440px]">
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border p-3" aria-label="Settings">
          {SECTIONS.map((item) => {
            const active = item.id === current.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-left text-[14px] ${active ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                onClick={() => onSectionChange(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 p-5">
          <h3 className="text-[15px] font-medium">{current.title}</h3>
          <div className="mt-4">
            {current.id === "copilot" ? (
              <CopilotSection
                settings={settings}
                checkingSignIn={checkingSignIn}
                signInNote={signInNote}
                signingOut={signingOut}
                onStartSignIn={onStartSignIn}
                onSignOut={() => void signOut()}
              />
            ) : null}
            {current.id === "github" ? (
              <GithubSection
                hasPat={settings?.hasGithubPat ?? false}
                token={githubPat}
                onToken={setGithubPat}
                onSave={() => void run(async () => { await fid().settings.saveGithubPat(githubPat); setGithubPat(""); }, "GitHub PAT saved")}
                onClear={() => void run(() => fid().settings.clearGithubPat(), "GitHub PAT removed")}
              />
            ) : null}
            {current.id === "jira" ? (
              <JiraSection
                hasToken={settings?.hasJiraToken ?? false}
                site={jiraSite}
                token={jiraToken}
                onSite={(value) => {
                  setJiraSiteDirty(true);
                  setJiraSite(value);
                }}
                onToken={setJiraToken}
                onSaveSite={() => void run(() => fid().settings.saveJiraSite(jiraSite), "Jira site saved")}
                onSaveToken={() => void run(async () => { await fid().settings.saveJiraToken(jiraToken); setJiraToken(""); }, "Jira token saved")}
                onClearToken={() => void run(() => fid().settings.clearJiraToken(), "Jira token removed")}
              />
            ) : null}
          </div>
          {message ? <p className="mt-4 text-[13px] text-success">{message}</p> : null}
          {error ? <p className="mt-4 text-[13px] text-destructive">{error}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}

function CopilotSection({
  settings,
  checkingSignIn,
  signInNote,
  signingOut,
  onStartSignIn,
  onSignOut,
}: {
  settings: Settings | null;
  checkingSignIn: boolean;
  signInNote: SignInNote | null;
  signingOut: boolean;
  onStartSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <div>
      <p className={`text-[14px] ${checkingSignIn && !settings?.signedIn ? "text-warning" : "text-foreground"}`} aria-live="polite">
        {settings?.signedIn ? settings.authStatus : checkingSignIn ? "Checking sign-in…" : settings?.authStatus ?? "Checking…"}
      </p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {settings?.cliFound ? settings.cliVersion : settings ? "CLI not found" : "Checking…"}
        {settings?.hasStoredToken ? " · saved token on" : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {settings && !settings.signedIn ? (
          <button type="button" className="rounded-lg bg-foreground px-3 py-2 text-[14px] text-background disabled:opacity-60" disabled={checkingSignIn} onClick={onStartSignIn}>
            {checkingSignIn ? "Checking sign-in…" : "Sign in with Copilot"}
          </button>
        ) : null}
        {settings?.signedIn ? (
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent disabled:opacity-50" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        ) : null}
      </div>
      {signInNote ? (
        <p className={`mt-3 text-[13px] ${signInNote.tone === "error" ? "text-destructive" : signInNote.tone === "ok" ? "text-success" : "text-warning"}`}>
          {signInNote.text}
        </p>
      ) : null}
    </div>
  );
}

function GithubSection({
  hasPat,
  token,
  onToken,
  onSave,
  onClear,
}: {
  hasPat: boolean;
  token: string;
  onToken: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <input
        type="password"
        className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input"
        value={token}
        autoComplete="off"
        placeholder="GitHub PAT"
        onChange={(event) => onToken(event.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent" onClick={onSave}>
          Save PAT
        </button>
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent" onClick={onClear}>
          Clear PAT
        </button>
      </div>
    </div>
  );
}

function JiraSection({
  hasToken,
  site,
  token,
  onSite,
  onToken,
  onSaveSite,
  onSaveToken,
  onClearToken,
}: {
  hasToken: boolean;
  site: string;
  token: string;
  onSite: (value: string) => void;
  onToken: (value: string) => void;
  onSaveSite: () => void;
  onSaveToken: () => void;
  onClearToken: () => void;
}) {
  return (
    <div>
      <label className="mt-3 block text-[14px]">
        <span className="mb-1 block font-medium">Site URL</span>
        <input
          className="w-full rounded-xl border border-border bg-card px-3 py-2 outline-none placeholder:text-muted-foreground focus:border-input"
          value={site}
          onChange={(event) => onSite(event.target.value)}
          placeholder="https://your-site.atlassian.net"
        />
      </label>
      <button type="button" className="mt-2 rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent" onClick={onSaveSite}>
        Save site
      </button>
      <input
        type="password"
        className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none placeholder:text-muted-foreground focus:border-input"
        value={token}
        autoComplete="off"
        placeholder={hasToken ? "Token saved — paste to replace" : "Jira API token"}
        onChange={(event) => onToken(event.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent" onClick={onSaveToken}>
          Save token
        </button>
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-[14px] hover:bg-accent" onClick={onClearToken}>
          Clear token
        </button>
      </div>
    </div>
  );
}
