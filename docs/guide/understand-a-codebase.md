# Understand a codebase

Most questions about a checked-out repository do not need an edit. Ask mode reads the workspace, follows the code, and answers with evidence. It cannot write files, run commands, use the browser, or change git.

## Ask mode

Choose **Ask mode** in the composer, before the model picker, to use the read-only tool set: file reads, search, a workspace explorer, git status/diff/log, and pull-request reads. Choose **Agent mode** when the agent should edit, run tests, or use its full tool profile. The switch is saved for the agent, and the conversation is kept when you switch.

The read-only guarantee is enforced by the tools the agent receives, not only by its instructions. A question that needs a command or a change ends with a suggestion to switch to Agent mode.

For a **Browser & Jira** agent, Ask mode keeps the read-only Jira tools and page reading with `browser_navigate` and `browser_snapshot`. It blocks clicking, typing, and form actions. Switch to Agent mode when the agent needs to operate a page.

![An agent in Ask mode with the composer mode switch and codebase starter prompts.](images/ask-mode.png)

When the thread is empty and the agent has a workspace, four starting points appear:

- **Explain architecture** — a one-paragraph overview, entry points, and main modules.
- **Trace a flow** — a Mermaid sequence diagram with numbered steps.
- **Review architecture** — the built-in `architecture-review` skill.
- **Troubleshoot an error** — a prompt where you paste a stack trace or log.

Choosing one fills the composer. Nothing is sent until you press Send.

## Project map

Choose the map button in the chat header to open the project map. On first use it offers **Build map**. One read-only exploration produces:

- an overview and entry points;
- a component table with key files;
- key runtime flows as Mermaid sequence diagrams;
- a suggested reading order;
- build and test commands;
- risks and unknowns.

The map is cached for the workspace and marked **Up to date** or **The repository changed since this map was built.** Choose **Refresh map** to rebuild it. Building a map spends one Copilot turn; opening a saved map does not. The cache key comes from git; in a folder that is not a git repository, choose **Refresh map** after changing files.

![The project map with a component diagram and a cached timestamp.](images/project-map.png)

## Architecture review and flows

`Review architecture` invokes the built-in skill. It returns a structured review: components, flows, boundaries, coupling, a risk table with evidence, test and observability gaps, and an explicit confidence and unknowns section. It is not a diff review; use `/review` for a change.

Runtime flows use Mermaid sequence diagrams. Module structure uses a flowchart. Data models can use an ER diagram. Expand any diagram to a full-screen view, zoom it, copy it as an image, or switch to its source. The same actions work in the help guide.

```mermaid
sequenceDiagram
  participant U as You
  participant A as Ask agent
  participant W as Workspace
  U->>A: Review architecture
  A->>W: Read files, search, git
  W-->>A: Evidence with path:line
  A-->>U: Report, risks, and diagrams
```

## Evidence and file preview

Architecture answers cite files as `path:line`, for example `src/main/chat/runner.ts:420`. Choose the citation to open a read-only preview with the line highlighted. The preview is limited to a window around the line; it does not modify the file.

## Troubleshooting

Use **Troubleshoot an error** and paste the stack trace or log after the prompt. Ask mode reads the code and log and explains the likely cause with evidence. If the answer needs a build or test run, switch to **Agent mode**.

## Start a codebase guide

When you create an agent, **Codebase guide** is the default template. It sets Ask mode, a short read-only instruction, and the developer tool profile for command availability. Choose **General agent** for an agent that edits and runs commands.

> **Keep in mind:** Ask mode is a tool boundary, not a sandbox. It can read any text file inside the workspace, so keep secrets out of the repository. It never writes, runs shell commands, or changes git.
