# How Fid Coder keeps AI memory

Each agent remembers through its chat transcript in local SQLite. That transcript is what GitHub Copilot sees on the next turn. The app does not keep a separate facts store, a running summary, or an embedding index.

The code lives in `src/main/db.ts` (storage) and `src/main/runner.ts` (what gets sent to Copilot).

## What is stored

Messages go in the `messages` table of `fid-coder.sqlite`. On Windows the file is `%APPDATA%\fid-coder\fid-coder.sqlite` (`app.getPath("userData")` after `app.setName("fid-coder")`). Set `FID_CODER_USER_DATA` to put the database somewhere else.

Each row belongs to one agent (`agent_id`). Foreign keys are on, and deleting an agent cascades to its messages. Agents do not share a transcript.

`Runner.runTurn` writes three roles:

| Role | What is saved |
|------|----------------|
| `user` | The text that was sent. A scheduled routine is stored as `[Routine] …`. |
| `tool` | Each tool result, clipped to 2,000 characters, as `toolName: …`. |
| `assistant` | The finished reply. An empty reply is stored as `No response.` A failed turn stores any partial text plus `Stopped: …`. |

The chat UI loads the full list for the selected agent through `messages:list`. Nothing is trimmed in the database.

## How the model sees it

`Runner` keeps one live Copilot session per agent in an in-memory map. The session stays open while its signature is unchanged. The signature is the agent's model plus the system message.

A new session is opened with `systemMessage: { mode: "replace", content }`. The system message is rebuilt from:

- the agent's system prompt
- `Workspace folder: …` when the agent has a workspace
- `Jira site URL: …` when that setting is saved
- a note that `JIRA_API_TOKEN` is available to `shell_run`, when a Jira token is saved
- a note that `GH_TOKEN` is available to `shell_run`, when a GitHub token is saved
- a fixed note that browser tools control a headed browser on this machine, that the agent has its own persistent profile, and that `browser_snapshot` comes before `browser_click` or `browser_type`

Two paths decide what text the turn sends:

- **Same session.** Later turns send only the new user text. Copilot already has the earlier turns in that session. A routine prefixes that text with `This turn was started by a schedule.`
- **New session.** The app loads every stored message for the agent, drops the user row just inserted for this turn, and keeps the last 30. Those rows are formatted as `role: content`, joined, and clipped to the last 12,000 characters. The prompt is `Previous conversation:` plus that transcript, then `User:` and the new text. The same routine lead is added in front. A new session with no earlier messages sends only the new text (plus the routine lead, when there is one).

A new session happens when the app process starts, because the map is only in memory. It also happens when the model or the system message changes, because that changes the signature and the old session is dropped.

Editing an agent drops that agent's session. Signing out of Copilot, or saving or clearing the GitHub token, the Jira site URL, or the Jira token, drops every session. The SQLite transcript stays. The next message rebuilds context from the last 30 rows.

During a live turn, tool results go back to Copilot as the tool handler's return value. The same text is saved as a `tool` message, so it is part of the transcript if the session is rebuilt later.

## What is not model memory

`remember` in `src/renderer/components/ChatView.tsx` keeps the in-progress turn on screen when you switch agents. That map stays in the renderer. It is not sent to Copilot.

Browser profiles under `%APPDATA%\fid-coder\browser-profiles\<agent-id>` keep logins and cookies for that agent. That is browser state. The system message tells the model the profile exists. The profile contents are not copied into the chat transcript.
