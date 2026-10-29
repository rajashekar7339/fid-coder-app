# Connect Copilot, GitHub, and Jira

Copilot is the account your agents use to think and call tools. GitHub and Jira tokens are optional connections that give developer agents access to pull requests and Jira data.

![Settings with a demo Copilot account connected and the optional GitHub and Jira connections enabled.](images/settings.png)

## Sign in to Copilot

Open **Settings → Copilot** and choose **Sign in with Copilot**. Finish the browser flow. The app checks the connection until your account appears. Use **Re-check** if the state looks stale, and **Sign out** to clear the saved session.

If the CLI is missing, install GitHub Copilot CLI and make sure `copilot` is on PATH.

## Add a GitHub token

Open **Settings → GitHub** and paste a personal access token. Agents with shell tools receive it as `GH_TOKEN` and `GITHUB_TOKEN`. Remove the saved token with **Remove token**.

## Add Jira access

Open **Settings → Jira** and save the site URL and an API token. Agents with shell tools receive `JIRA_API_TOKEN` and `JIRA_SITE`, and the site URL is added to the system message.

## Where the credentials live

Tokens are encrypted with Windows `safeStorage` and stored in `secrets.bin.json` under `%APPDATA%\fid-coder`. The app does not send them to Copilot or print them in chat. A local tool such as `gh` can use its token to call its own service.

Changing a token drops every live Copilot session. The saved conversations stay; the next message rebuilds context from the transcript.

> **Tip:** Copilot is required. GitHub and Jira are optional, and browser-only agents do not need their tokens.
