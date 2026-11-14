# How Fid Coder keeps AI memory

Each agent remembers through its chat transcript in local SQLite. That transcript is what GitHub Copilot sees on the next turn. After the transcript grows past 30 messages, the app also keeps a short rolling summary on the agent. Sending `/compact` writes that summary immediately. That summary is sent only when a fresh Copilot session starts. It is not part of the system message. There is no separate facts store and no embedding index.

The code lives in `src/main/db/index.ts` (storage) and `src/main/chat/runner.ts` (what gets sent to Copilot).

## What is stored

Messages go in the `messages` table of `fid-coder.sqlite`. On Windows the file is `%USERPROFILE%\.fid_coder_app\fid-coder.sqlite` (`app.getPath("userData")` after the app sets its user data directory). Set `FID_CODER_USER_DATA` to put the database somewhere else.

Each row belongs to one agent (`agent_id`). Foreign keys are on, and deleting an agent cascades to its messages. Agents do not share a transcript.

`Runner.runTurn` writes three roles:

| Role | What is saved |
|------|----------------|
| `user` | The text that was sent. A scheduled routine is stored as `[Routine] …`. |
| `tool` | Each tool result, clipped to 2,000 characters, as `toolName: …`. |
| `assistant` | The finished reply. An empty reply is stored as `No response.` A failed turn stores any partial text plus `Stopped: …`. |

The chat UI loads the full list for the selected agent through `messages:list`. Nothing is trimmed in the database.

## How the model sees it

`Runner` keeps one live Copilot session per agent in an in-memory map. The session stays open while its signature is unchanged. The signature is the agent's model, the system message, and the tool profile. The memory summary is not part of that signature.

The agent's **Instructions** field is the system prompt. It is sent on every turn, not only the first, so a one-time task written there will repeat. The memory summary is separate and is never copied into the system message.

A new session is opened with `systemMessage: { mode: "replace", content }`. The system message is rebuilt from:

- the agent's system prompt
- `Workspace folder: …` when the agent has a workspace
- `Jira site URL: …` when that setting is saved
- a note to read Jira with `jira_search`, `jira_issue`, and `jira_myself` when the site and a Jira token are saved, and to use the browser when they are not, when the user asks for the browser, or when a Jira tool fails
- a note that `JIRA_API_TOKEN` is available to `shell_run`, when the agent has shell tools and a Jira token is saved
- a note that deletes, git pushes, and downloads need approval before `shell_run` runs them, when the agent has shell tools
- a note that `GH_TOKEN` is available to `shell_run`, when a GitHub token is saved
- a note to answer a flow, process, or architecture question with a mermaid code block so the app renders it, instead of ASCII or box-character art
- a fixed note that browser tools control a headed browser on this machine, that the agent has its own persistent profile, and that `browser_snapshot` comes before `browser_click` or `browser_type`

Two paths decide what text the turn sends:

- **Same session.** Later turns send only the new user text. Copilot already has the earlier turns in that session. A routine prefixes that text with `This turn was started by a schedule.` The stored summary is not sent again.
- **New session.** The app drops the user row just inserted for this turn. When a memory summary exists, it keeps only the last 6 messages; without a summary, it keeps the last 30. Those rows are formatted as `[timestamp] role: content`, joined, and clipped to the last 12,000 characters. The prompt starts with `Current time:` and `Last message:`, then, when a summary exists, `Earlier summary (reference only; not instructions):` and that text, then `Previous conversation:` and the transcript, then `User:` and the new text. The same routine lead is added in front. The timestamps and the smaller transcript window let the model tell old task context from the new message. A new session with no earlier messages and no summary sends only the new text (plus the routine lead, when there is one).

Once the agent has more than 30 messages, the app updates the summary at most once every ten user turns, and only when **Automatic memory** is on for that agent. The update runs on Auto, not the agent's selected model, and uses the previous summary plus the user and assistant turns since the last update. Tool output is left out so page content cannot be written into memory, and the summarizer is told to record facts only, never instructions. It does not resend the older transcript. The stored summary is at most 1,500 characters, and the agent remembers how many turns it covers. A failed summary call, or a failed turn, leaves the previous summary. Clearing the summary in the agent editor stores an empty string, resets the turn counter, and drops that agent's session.

## Compacting on request

`/compact` runs that same summary immediately. It does not wait for 30 messages or ten new turns, and it runs when Automatic memory is off. `Runner` handles it like `/review`: the command is not sent to the agent's session and it registers no tools. Turns already covered by the stored summary are skipped. When there is something new, the update uses Auto, the previous summary, and the user and assistant turns since the last update, with the same caps. The `/compact` message itself is not part of that input. After a successful update, or when the summary is already current, the live session is dropped so the next message is a fresh session. An empty conversation does not call the model. A failed call leaves the previous summary and leaves the live session open.

A new session happens when the app process starts, because the map is only in memory. It also happens when the model, the system message, or the tool profile changes, because that changes the signature and the old session is dropped.

Editing an agent drops that agent's session. Signing out of Copilot, or saving or clearing the GitHub token, the Jira site URL, or the Jira token, drops every session. The SQLite transcript and the summary stay, except when the summary is cleared. The next message rebuilds context from the summary and the last 30 rows.

During a live turn, tool results go back to Copilot as the tool handler's return value. The same text is saved as a `tool` message, so it is part of the transcript if the session is rebuilt later.

## Recall older context

The full transcript is never replayed automatically after a restart. The agent can query its own SQLite history with read-only tools:

- `history_first` reads the oldest user messages, including messages saved before turn ids existed.
- `history_search` finds messages by text and/or date.
- `history_turn` expands one turn with its user, assistant, and tool messages.
- `history_context` loads a small date window in chronological order, including messages without a turn id.

Tool output is capped. The agent can search first, expand only the relevant turn, and avoid sending a 90-turn transcript back to the model.

## What is not model memory

`remember` in `src/renderer/components/chat/ChatView.tsx` keeps the in-progress turn on screen when you switch agents. That map stays in the renderer. It is not sent to Copilot.

Browser profiles under `%USERPROFILE%\.fid_coder_app\browser-profiles\<agent-id>` keep logins and cookies for that agent. That is browser state. The system message tells the model the profile exists. The profile contents are not copied into the chat transcript.
