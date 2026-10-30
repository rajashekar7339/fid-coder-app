# Connect Copilot, GitHub, and Jira

Copilot is the account your agents use to think and call tools. GitHub and Jira tokens are optional connections that give developer agents access to pull requests and Jira data.

![Settings with a demo Copilot account connected and the optional GitHub and Jira connections enabled.](images/settings.png)

## Sign in to Copilot

Open **Settings → Copilot** and choose **Sign in with Copilot**. Finish the browser flow. The app checks the connection until your account appears. Use **Re-check** if the state looks stale, and **Sign out** to clear the saved session.

If the CLI is missing, install GitHub Copilot CLI and make sure `copilot` is on PATH.

## Add a GitHub token

Open **Settings → GitHub** and paste a personal access token. Agents with shell tools receive it as `GH_TOKEN` and `GITHUB_TOKEN`. Remove the saved token with **Remove token**.

## Add Jira access

Open **Settings → Jira** and save the site URL and a personal access token (PAT). When both are saved, browser agents read the site with `jira_search`, `jira_issue`, and `jira_myself`. Without a PAT, or when you ask the agent to use the browser, it uses the browser instead. If a Jira tool fails, the app logs the failure and the agent uses the browser. Agents with shell tools also receive `JIRA_API_TOKEN` and `JIRA_SITE`.

## Where the credentials live

Tokens are encrypted with Windows `safeStorage` and stored in `secrets.bin.json` under `%APPDATA%\fid-coder`. The app does not send tokens to Copilot or print them in chat. A local tool such as `gh` can use its token to call its own service.

Saving or clearing a token or the Jira site drops every live Copilot session. The saved conversations stay; the next message rebuilds context from the transcript.

> **Tip:** Copilot is required. GitHub and Jira are optional. A browser agent reads Jira with a saved site and PAT, or through the browser when no PAT is saved.
