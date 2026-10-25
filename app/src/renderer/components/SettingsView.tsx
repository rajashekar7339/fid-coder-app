import { useEffect, useState } from "react";
import type { SettingsView as Settings } from "../../shared/types";
import { errorText, fid } from "../fid";

type SignInNote = { tone: "progress" | "ok" | "error"; text: string };

type Props = {
  settings: Settings | null;
  checkingSignIn: boolean;
  signInNote: SignInNote | null;
  onStartSignIn: () => void;
  onSaved: () => void;
  onSignedOut: (next: Settings) => void;
};

export function SettingsView({ settings, checkingSignIn, signInNote, onStartSignIn, onSaved, onSignedOut }: Props) {
  const [githubPat, setGithubPat] = useState("");
  const [jiraToken, setJiraToken] = useState("");
  const [jiraSite, setJiraSite] = useState("");
  const [jiraSiteDirty, setJiraSiteDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!jiraSiteDirty && settings) setJiraSite(settings.jiraSiteUrl);
  }, [settings, jiraSiteDirty]);

  async function signOut() {
    const confirmed = window.confirm("Sign out of GitHub Copilot on this computer? The next chat has to sign in again.");
    if (!confirmed) return;
    setSigningOut(true);
    setError(null);
    setMessage(null);
    try {
      const signOutFn = fid().settings.signOut;
      if (typeof signOutFn !== "function") {
        throw new Error("Restart Fid Coder, then sign out again.");
      }
      const next = await signOutFn();
      setJiraSite(next.jiraSiteUrl);
      setJiraSiteDirty(false);
      onSignedOut(next);
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
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-1 flex-col gap-6 overflow-auto p-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-zinc-600">Tokens stay in Windows encryption. The chat window never receives them.</p>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">GitHub Copilot</h2>
        <p className={`mt-2 text-sm ${checkingSignIn && !settings?.signedIn ? "text-amber-800" : "text-zinc-700"}`} aria-live="polite">
          {settings?.signedIn ? settings.authStatus : checkingSignIn ? "Checking sign-in…" : settings?.authStatus ?? "Checking…"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {settings?.cliFound ? settings.cliVersion : settings ? "CLI not found" : "Checking…"}
          {settings?.hasStoredToken ? " · saved token on" : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {settings && !settings.signedIn ? (
            <button
              type="button"
              className="rounded-md bg-zinc-950 px-3 py-2 text-sm text-white disabled:opacity-60"
              disabled={checkingSignIn}
              onClick={onStartSignIn}
            >
              {checkingSignIn ? "Checking sign-in…" : "Sign in with Copilot"}
            </button>
          ) : null}
          {settings?.signedIn ? (
            <button
              type="button"
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          ) : null}
        </div>
        {signInNote ? (
          <p className={`mt-3 text-sm ${signInNote.tone === "error" ? "text-red-700" : signInNote.tone === "ok" ? "text-emerald-700" : "text-amber-800"}`}>
            {signInNote.text}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">GitHub pull requests</h2>
        <p className="mt-1 text-sm text-zinc-600">
          {settings?.hasGithubPat ? "A PAT is saved." : "No PAT saved."} shell_run receives it as GH_TOKEN and does not print it.
        </p>
        <input
          type="password"
          className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={githubPat}
          autoComplete="off"
          placeholder="GitHub PAT"
          onChange={(event) => setGithubPat(event.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button type="button" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void run(async () => { await fid().settings.saveGithubPat(githubPat); setGithubPat(""); }, "GitHub PAT saved")}>
            Save PAT
          </button>
          <button type="button" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void run(() => fid().settings.clearGithubPat(), "GitHub PAT removed")}>
            Clear PAT
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="font-medium">JIRA</h2>
        <p className="mt-1 text-sm text-zinc-600">The JIRA agent signs in through its own browser profile. A site URL and API token are optional.</p>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">Site URL</span>
          <input
            className="w-full rounded-md border border-zinc-300 px-3 py-2"
            value={jiraSite}
            onChange={(event) => {
              setJiraSiteDirty(true);
              setJiraSite(event.target.value);
            }}
            placeholder="https://your-site.atlassian.net"
          />
        </label>
        <button type="button" className="mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void run(() => fid().settings.saveJiraSite(jiraSite), "JIRA site saved")}>
          Save site
        </button>
        <input
          type="password"
          className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={jiraToken}
          autoComplete="off"
          placeholder={settings?.hasJiraToken ? "Token saved — paste to replace" : "JIRA API token"}
          onChange={(event) => setJiraToken(event.target.value)}
        />
        <div className="mt-2 flex gap-2">
          <button type="button" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void run(async () => { await fid().settings.saveJiraToken(jiraToken); setJiraToken(""); }, "Jira token saved")}>
            Save token
          </button>
          <button type="button" className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void run(() => fid().settings.clearJiraToken(), "JIRA token removed")}>
            Clear token
          </button>
        </div>
      </section>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
