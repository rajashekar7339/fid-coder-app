# Add skills to an agent

A skill is a reusable `SKILL.md` instruction file that changes how one agent works. Skills belong to the agent: enabling a skill on one agent does not change any other agent.

## Where skills come from

Fid Coder reads skills from these places:

- **Built-in** — the app's `skills` folder. Start with **Review a change** and **Write lean**.
- **Your skills** — `%USERPROFILE%\.fid_coder_app\skills`.
- **Workspace** — `.github/skills`, `.agents/skills`, and `.claude/skills` under the agent's workspace folder.
- **Copilot** — `~/.copilot/skills` and `~/.agents/skills`.

When two skills use the same folder name, the workspace copy wins. Then come **Your skills**, **Copilot**, and the built-in copy. The agent editor shows the source and reports a hidden copy.

## Add or remove a skill

1. Open the agent's menu and choose **Edit agent**, or create a new agent.
2. Find **Skills**, below **Tools**.
3. Check the skills this agent should follow. Uncheck one to remove it.
4. Choose **Create agent** or **Save changes**.

The **Skills** row under the chat header lists the active skills for the selected agent. Other agents keep their own lists.

## Read before you enable

Each row shows its source and character count. Choose **View** to read the instructions and see the file path. Workspace and Copilot skills are files on this PC; read one before checking it.

A skill over 8,000 characters is marked **will be truncated**. The field also shows the selected total against the 16,000-character prompt budget. If the total is too high, later skills are shortened or left out of the prompt.

## Add your own skill

Create a folder under `%USERPROFILE%\.fid_coder_app\skills`, then add `SKILL.md`:

```md
---
name: Release notes
description: Draft release notes from merged pull requests.
---

Read the pull request titles and write three short sections: changes, risks, and testing gaps.
```

`name` and `description` are required. Choose **Refresh** in the agent editor after adding a folder; **Open skills folder** opens the app skills folder. A malformed file appears under "Some skill files were skipped" with the reason.

A workspace can share a skill with its repository by adding `.github/skills/<name>/SKILL.md`.

## Commands in the composer

Type `/` in the composer, or choose **Commands** next to the model picker, to open the list.

- `/review` — review uncommitted changes, staged changes, a branch, a PR number, or a path.
- `/skills` — open this agent's skills editor.
- `/help` — open this guide.

Use ↑/↓ to move, Enter or Tab to select, and Escape to close. A command that needs a workspace or developer tools shows the reason in the list. The chat empty state also shows the available commands as chips.

## Ask for a code review

A developer or all-tools agent has the **/review** command. Type `/review` and add `staged`, `branch <name>`, `pr <number>`, or a path. Leave the target empty to review the uncommitted changes. The review runs in a read-only session: it can read files, search, and use git reads, but it cannot edit files, run shell commands, or control a browser. The chat shows the findings.

> **Keep in mind:** a skill is guidance. It does not override the app's approval rules, tool limits, or the workspace rules. The host still decides which tools the agent can use.
