# Feature enhancements

Planned feature work for Fid Coder after the current cockpit, workspace tools, checkpoints, routines, and integrations.

Last updated: 30 October 2026.

## Product constraints

- GitHub Copilot is the only model backend.
- No Docker and no remote browser.
- Tools stay rooted in the agent workspace.
- The browser is local and headed, with one profile per agent.
- Agents, transcripts, checkpoints, and settings stay on the PC.
- Keep changes small and match the existing architecture in `AGENTS.md`.

## Current baseline

Already shipped:

- The cockpit: sidebar, conversation, and Agent Desk.
- Agent CRUD with model, tool profile, workspace, and long-term memory.
- Per-agent headed browser and Jira tools.
- GitHub pull request tools and the GitHub token.
- Native workspace tools: list, glob, search, read, write, patch, git, and shell.
- `explore_code`, the workspace brief, and project rules.
- Turn checkpoints, file diffs, and revert.
- Routines with cron schedules, manual runs, and Windows toasts.
- Copilot usage, the help center, and the portable Windows build.

Gaps this plan addresses:

- One agent has exactly one transcript and one running turn.
- A risky shell command is gated by a prompt convention, not a host-enforced decision.
- Routines expose only `last_status` and stop when the app quits.
- The composer only accepts text.
- The tool surface is fixed in code.

## Planned features

| # | Feature | Status | Size | Depends on |
|---|---|---|---|---|
| 1 | Chats (threads) per agent | Planned | L, 4–6 dev days | — |
| 2 | Approval center | Shipped | M, 3–5 dev days | — (turn-scoped until #1) |
| 3 | Routines 2.0: tray, history, inbox | Planned | M, 4–5 dev days | #1 |
| 4 | Composer attachments | Planned | M, 2–4 dev days | #1 |
| 5 | MCP tool servers | Planned | L, 4–6 dev days | #2 |

Sizes are focused development estimates, not commitments.

A sixth, vertical use case — the configurable release impact analyst — is specified after #5. It is a separate track: a reusable engine plus team configuration, not another cockpit change.

---

### 1. Chats (threads) per agent

**Status:** Planned
**Size:** L, 4–6 focused dev days
**Depends on:** nothing

#### Problem

An agent is both identity and conversation. `messages` and `turns` are keyed by `agent_id`, and `Runner` keeps one session and one running turn per agent. A routine writes into the same transcript as interactive work. Starting a new task means carrying a large old context or creating another agent.

#### What ships

- **New chat** in the conversation header and with `Ctrl+N`.
- A thread history popover with title search, rename, delete, and archive.
- Auto-title from the first user message, editable.
- Every thread has its own transcript, turn changes, and live turn.
- Routines write to their own thread instead of the interactive transcript.
- Switching threads during a run preserves both live views.

#### Implementation notes

- Add a `conversations` table: `id`, `agent_id`, `title`, `created_at`, `updated_at`, `archived_at`.
- Add `conversation_id` to `messages` and `turns`.
- Change the Runner session cache key from `agentId` to `agentId:conversationId`, and keep the active turn per conversation.
- Add `conversationId` to every `ChatEvent` so the renderer filters by thread, not agent.
- Keep agent memory long-term and agent-wide. The thread transcript is the working context; a thread carries its own change set.
- Migrate existing data by creating one `Main` thread per agent and assigning all existing messages and turns. No data is deleted.
- Add `conversations.list/create/rename/delete`, change `messages.list` to take a conversation id, and change `chat.send` to take a conversation id.
- Update `ChatView`, `App`, and the sidebar; add a `ChatHistory` component.

#### Done when

Two threads on one agent have separate transcripts and change sets, a running turn in one does not leak into the other, and existing data survives the migration.

#### Risks

- The migration touches every stored message and turn. Cover it with an integration test against a seeded pre-thread database.
- Memory semantics need to stay clear: long-term facts live on the agent, task context lives in the thread.

---

### 2. Approval center

**Status:** Shipped (turn-scoped; thread-scoped audit lands with #1)
**Size:** M, 3–5 focused dev days
**Depends on:** — (turn-scoped until #1)

#### Problem

`shell_run` returns `DELETE_CONFIRM_REQUIRED` unless the model passes `confirmed: true`. The host cannot prove the user approved; the model can set the flag itself. The approval bar is a chat round-trip and only appears after the turn stops. There is no deny path, no saved policy, and no audit.

#### What ships

- A compact inline approval card in the conversation that names the command, working directory, and risk reason.
- **Allow once**, **Always allow**, **Reject**, and **Always deny**.
- Per-agent policy: ask by default, with saved allow and deny rules; deny wins.
- A timeout that denies automatically, and Stop that denies a pending request.
- An audit history of every request and decision.
- The same mechanism will cover MCP tools added in #5.

#### Implementation notes

- Add `ToolContext.requestApproval(request)` returning a decision.
- Add a pending-approval map in `Runner`, keyed by approval id.
- Emit `approval-request` and `approval-resolved` `ChatEvent`s; add a `chat:approval` IPC channel.
- Add `approvals` and `approval_rules` tables. The audit row records command, cwd, reason, decision, agent, conversation, turn, and time.
- Update `shell_run` to await the decision for deletes, git pushes, and downloads. Remove `DELETE_CONFIRM_MARKER`, the `confirmed` argument, and the chat confirmation bar.
- Add a **Safety** section to Settings for saved rules, plus a history view in the Agent Desk.
- Keep the SDK permission handler for unknown tools; use the new bridge for Fid Coder tools.

#### Done when

A `git push` cannot run without an out-of-band decision, rejecting returns a denial to the model, and every decision is recorded.

#### Risks

- A tool handler waits on the UI. Timeout, Stop, and window close must all resolve the promise as a denial.
- Saved rules must be easy to review and remove; an accidental "always allow" should not be permanent without a visible list.

---

### 3. Routines 2.0: tray, history, inbox

**Status:** Planned
**Size:** M, 4–5 focused dev days
**Depends on:** #1

#### Problem

Routines keep only `last_status`. A run's output is buried in the agent transcript. Closing the window quits the app, so scheduled work stops. Toast notifications do not open anything, and skipped runs are easy to miss.

#### What ships

- A tray icon with Open, Pause all routines, and Quit.
- An option to keep running when the window closes, and start at login.
- Per-routine run history: trigger, start, duration, status, output excerpt, and **Open chat**.
- A global inbox with unread count, filters, and mark-read.
- Toast click opens the run's thread.
- A missed-run policy for schedules that fire while the app is off.

#### Implementation notes

- Add a `routine_runs` table: routine, agent, conversation, trigger, status, started/ended, turn, output, error, read time.
- Make `Runner.runTurn` return the turn id and conversation id so the scheduler can record a run.
- Record running, ok, error, and skipped states in `Scheduler`.
- Add a `Tray`; intercept window close when the keep-running setting is on, and quit explicitly from the tray.
- Use `app.setLoginItemSettings` for start at login, with a hidden-start argument.
- Add a notification click handler that focuses the window and navigates to the run.
- Add a History tab to `RoutinesDialog`, a last-run row in `AgentDesk`, and an `InboxDialog` opened from a sidebar bell.
- Prune old runs on launch (for example, 90 days).

#### Done when

A weekday morning Jira digest runs with the window hidden, raises a toast, and lands in the inbox with a working deep link.

#### Risks

- Tray lifecycle and quit behavior can confuse users; make the setting explicit and show it on first close.
- A crash during a run must not duplicate the run on next launch. Record the run before work starts and reconcile on startup.
- Background browser runs still open a headed browser; document that behavior.

---

### 4. Composer attachments

**Status:** Planned
**Size:** M, 2–4 focused dev days
**Depends on:** #1

#### Problem

The composer is text-only. Coding and browser work often needs a screenshot, a log, a CSV, or a specification. The Copilot SDK already supports file and blob attachments.

#### What ships

- A paperclip button, drag/drop, and paste-image.
- Multiple attachments with thumbnails, names, sizes, and remove.
- Attachments persist with the message and can be opened or revealed.
- Limits: for example, 8 files, 20 MB each, and 50 MB per message.
- A clear note that attachments are user-provided data, not instructions.

#### Implementation notes

- Add an attachments directory under the user data folder, scoped by agent and conversation.
- Add a `files:pick` IPC handler and use `webUtils.getPathForFile` in the sandboxed preload for drag/drop.
- Paste-image has no file path; read the clipboard file as bytes and save it through the main process.
- Add a `messages.attachments` JSON column and a `MessageAttachment` shared type.
- Widen the `SessionLike.sendAndWait` input to accept attachments; pass them from `Runner`.
- On a rebuilt session, reattach only the latest user message. Earlier attachments stay visible in the transcript and are referenced by name.
- Clean up attachment files when a thread or agent is deleted.

#### Done when

Paste a screenshot and drag a log, reload the app, and both still render; a rebuilt session can still read the latest attachments.

#### Risks

- Images and large files consume context. Cap size and compression, and show the limit before sending.
- Copied files duplicate data. Use content hashes and clean up with the owning thread.
- Treat attachments as untrusted input; never execute or import them automatically.

---

### 5. MCP tool servers

**Status:** Planned
**Size:** L, 4–6 focused dev days
**Depends on:** #2

#### Problem

Every integration is native code under `src/tools`. Adding an internal system means changing the app. The Copilot SDK already supports MCP servers, so the app can expose external tools without building each integration.

#### What ships

- **Settings → Tools** for adding a local stdio server with command, args, environment, and working directory.
- Test connection and tool discovery.
- Per-agent enablement with a tool list.
- MCP tools shown in the Context inspector.
- MCP tool calls routed through the approval center.

#### Implementation notes

- Add an `mcp_servers` table and a per-agent assignment.
- Store server environment values and HTTP headers in `secrets.ts`, never in plain settings.
- Pass `mcpServers` from `Runner.sessionFor` into `openSession`.
- Include the MCP configuration in the session signature so edits drop the cached session.
- Bridge MCP permission requests to the approval center; fail closed for unknown tools.
- Start with stdio only. Keep HTTP behind an advanced flag with a clear warning, since the product is local-first.
- Add the server and tool names to `ContextView` so the Context inspector stays honest.

#### Done when

A fixture MCP server's tools appear in an agent's Context view, a call shows up as a normal tool card, and write-like tools require approval.

#### Risks

- Tool explosion can consume context. Enable servers per agent and allow a tool filter.
- MCP servers are arbitrary local processes. Show the exact command before saving, and never auto-approve unknown write tools.
- Remote MCP conflicts with the local-first constraint; keep it off by default.

---

### 6. Configurable release impact analyst

**Status:** v1 in the app. A large diff keeps the prioritized tests. Full regression is only for configured policy paths, contract files, a failed adapter, or an unreadable repo. Custom adapters, Jira lookups, and a scheduled routine are not included.
**Size:** L, 2–3 weeks for a reusable v1
**Depends on:** #2 for shell safety; multi-repo workspace support is recommended, but the standalone CLI works with a parent folder today
**Track:** separate use-case track

#### Problem

A release is spread across three source repos and one automation repo. Every change triggers the full regression suite plus the tests related to the change. The team needs one analysis that answers:

1. What changed between prod and the candidate release?
2. Which existing automation tests must run?
3. Which new scenarios need automation?
4. What will break or drift between the source changes and the automation?

If repo names, refs, test paths, frameworks, and mappings are hardcoded, only one team can use it. The feature has to be a generic engine driven by a per-team config.

#### Goal

A team can adopt the feature by:

- copying the engine or installing the CLI,
- writing one config file,
- creating an agent from the built-in preset.

No code changes and no team names in the engine.

#### Architecture

```text
prod refs / candidate refs / release manifest
        |
        v
[collect]  git diff, log, classify, extract signals  --> changes.json
        |
        v
[index]    test inventory + selectors/endpoints/routes --> tests.json
        |
        v
[match]    explicit map + exact signals + keywords    --> candidates.json
        |
        v
[review]   Fid Coder agent: rank, gaps, risks         --> impact-report.md
        |
        v
[emit]     selected-tests.json + CI format
```

The engine is deterministic. The agent adds judgment only after the candidate set is small.

#### Configuration model

Config discovery order:

1. `--config <path>`
2. `.release-impact/config.json` in the workspace
3. `release-impact.config.json` at the workspace root

`schemaVersion` is required. Unknown keys are rejected. All paths are relative to the workspace and must resolve inside it.

Example `.release-impact/config.json`:

```json
{
  "schemaVersion": 1,
  "team": "example-team",
  "repos": [
    {
      "id": "service-a",
      "path": "repos/service-a",
      "role": "source",
      "language": "java",
      "prod": "refs/tags/prod-2026.09.1",
      "candidate": "origin/release/2026.10"
    },
    {
      "id": "service-b",
      "path": "repos/service-b",
      "role": "source",
      "language": "typescript",
      "prod": "refs/tags/prod-2026.09.1",
      "candidate": "origin/release/2026.10"
    },
    {
      "id": "service-c",
      "path": "repos/service-c",
      "role": "source",
      "language": "csharp",
      "prod": "refs/tags/prod-2026.09.1",
      "candidate": "origin/release/2026.10"
    },
    {
      "id": "automation",
      "path": "repos/automation",
      "role": "automation",
      "framework": "playwright",
      "testGlobs": ["tests/**/*.spec.ts"],
      "caseIdPattern": "\\[TC-\\d+\\]",
      "prod": "refs/tags/prod-2026.09.1",
      "candidate": "origin/release/2026.10"
    }
  ],
  "ignore": [
    "**/node_modules/**",
    "**/dist/**",
    "**/target/**",
    "**/build/**",
    "**/*.lock"
  ],
  "mapping": {
    "explicit": [
      {
        "match": "service-a/src/**/orders/**",
        "tests": ["automation/tests/orders/**"]
      },
      {
        "match": "service-b/src/pages/checkout/**",
        "tests": ["automation/tests/checkout/**"]
      }
    ],
    "contracts": [
      {
        "repo": "service-a",
        "type": "openapi",
        "path": "api/openapi.yaml"
      }
    ]
  },
  "policy": {
    "fullRegression": [
      "**/auth/**",
      "**/migrations/**",
      "**/openapi*.yaml",
      "**/pom.xml",
      "**/package-lock.json"
    ],
    "minMappingCoverage": 0.7,
    "maxChangedFiles": 400,
    "allowCustomAdapters": false
  },
  "outputs": {
    "report": "artifacts/impact-report.md",
    "selection": "artifacts/selected-tests.json",
    "selectionFormat": "playwright-grep"
  },
  "jira": {
    "enabled": true,
    "projectKeys": ["PAY"]
  }
}
```

Field reference:

| Field | Required | Purpose |
|---|---|---|
| `schemaVersion` | Yes | Config schema version; the engine refuses an unknown major version |
| `team` | No | Metadata only; never used in logic |
| `releaseManifest` | No | Path to a JSON file that pins prod and candidate SHAs for every repo |
| `repos[].id` | Yes | Unique name used in reports and evidence |
| `repos[].path` | Yes | Repo path relative to the workspace |
| `repos[].role` | Yes | `source`, `automation`, or `contract` |
| `repos[].language` | No | Improves signal extraction; falls back to generic |
| `repos[].framework` | Automation only | Selects the test adapter; use `custom` with `adapterPath` |
| `repos[].adapterPath` | No | Custom adapter module, relative to the workspace; requires the policy opt-in |
| `repos[].prod`, `repos[].candidate` | No | Git refs or SHAs; a release manifest can supply them |
| `repos[].testGlobs` | Automation only | Files the adapter indexes |
| `repos[].caseIdPattern` | No | Regex for stable test IDs such as `TC-1042` |
| `ignore` | No | Diff paths and automation test files the engine never scans. Folders named `Deprecated` in the automation repo are always skipped |
| `mapping.explicit[]` | No | Team-owned code-to-test rules; highest confidence |
| `mapping.contracts[]` | No | OpenAPI, GraphQL, or protobuf files used for contract checks |
| `policy.fullRegression` | No | Source or contract paths that always force the full suite; automation test changes do not trigger it |
| `policy.minMappingCoverage` | No | Below this coverage, add a note. The selected tests stay |
| `policy.maxChangedFiles` | No | Above this source/contract changed-file count, add a note. The selected tests stay; automation test changes do not count |
| `policy.maxDetailFiles` | No | Changed files that get signal extraction; default 400 |
| `policy.maxTestFiles` | No | Test files indexed from the automation repo; default 500 |
| `policy.allowCustomAdapters` | No | Opt in to loading a team-provided adapter module |
| `outputs.*` | Yes | Report and selection paths under `artifacts/`, and CI format |
| `jira.*` | No | Turn commit/PR ticket keys into Jira lookups |

When `releaseManifest` is set, the per-repo `prod` and `candidate` fields are optional. The manifest wins so a release cannot accidentally compare moving branches.

Environment overrides for CI:

```bash
release-impact analyze \
  --config .release-impact/config.json \
  --prod "$PROD_SHA" \
  --candidate "$CANDIDATE_SHA" \
  --output artifacts/
```

`--prod` and `--candidate` override repo-level refs when a release manifest is not used.

#### Release manifest

Branch names drift. Prefer a manifest written by the release pipeline:

```json
{
  "prod": {
    "service-a": "a1b2c3d",
    "service-b": "e4f5g6h",
    "service-c": "i7j8k9l",
    "automation": "m0n1o2p"
  },
  "candidate": {
    "service-a": "q3r4s5t",
    "service-b": "u6v7w8x",
    "service-c": "y9z0a1b",
    "automation": "c2d3e4f"
  }
}
```

Point `releaseManifest` at it in the config. If a repo has no source ref for prod, the engine cannot diff it and should say so instead of guessing.

#### Adapters

The only code that should differ per team is the adapter that understands its test framework.

| Adapter | What it extracts |
|---|---|
| `playwright` | Spec files, test titles, tags, `data-testid`, routes, fixtures |
| `cypress` | Spec files, test titles, selectors, routes, fixtures |
| `testng` / `junit` | Classes, methods, groups, test IDs, suite XML |
| `jest` / `vitest` | Test files, names, tags, imports |
| `cucumber` | Feature files, scenarios, tags, step definitions |
| `robot` | Robot suites, test names, tags, keywords |
| `generic` | File globs plus regex for test names and IDs |
| `openapi` / `graphql` / `proto` | Contract fields and endpoints |

Adapter contract:

```ts
export interface TestAdapter {
  id: string;
  discover(input: {
    repoPath: string;
    config: AutomationRepoConfig;
  }): Promise<TestInventory>;
  renderSelection(tests: TestCase[], format: SelectionFormat): string;
}
```

Rules:

- Built-in adapters only by default.
- A team with an uncommon framework uses `generic` first.
- Custom adapter modules require `policy.allowCustomAdapters: true` and `repos[].adapterPath` with an explicit relative path. Never load adapter code from an untrusted workspace without that opt-in.
- A broken adapter fails closed: recommend full regression, not an empty selection.

Selection formats:

- `file-list` — one test file per line.
- `playwright-grep` — a `--grep` pattern.
- `testng-xml` — a generated suite file.
- `cucumber-tags` — a tag expression.
- `junit` — class/method list.
- `json` — the full structured selection.

#### Pipeline and outputs

1. **Resolve** — resolve every ref to a SHA, or read the release manifest. Record the SHAs in the report.
2. **Collect** — per repo: `git merge-base`, `git log --oneline --no-merges`, `git diff --name-status --find-renames`, `git diff --stat`, and `git diff -U0` for changed files. Classify each file and extract signals: endpoints, routes, DTO fields, symbols, selectors, config keys, error codes, ticket keys. Ignore lockfiles, generated code, binaries, and vendored paths.
3. **Index** — read the automation repo at the candidate ref and run the adapter. Cache by automation SHA.
4. **Match** — score every test against the changes, highest to lowest: explicit map, exact endpoint/route/schema/selector match, changed test itself, symbol keyword match, same module, historical failure. Apply penalties for disabled or flaky tests. Tier as `must`, `should`, `optional`.
5. **Review** — the agent receives the change summary, top hunks, candidate tests with evidence, relevant test files, and Jira acceptance criteria. It confirms or downgrades candidates, finds gaps, predicts failures, and cites `path:line`.
6. **Emit** — write the Markdown report and the machine-readable selection.

`selected-tests.json` shape:

```json
{
  "release": {
    "prod": {
      "service-a": "a1b2c3d"
    },
    "candidate": {
      "service-a": "q3r4s5t"
    }
  },
  "mustRun": [
    {
      "id": "TC-1042",
      "name": "Checkout applies a discount",
      "file": "automation/tests/checkout/discount.spec.ts",
      "suite": "checkout",
      "reason": "The pricing endpoint changed and this test asserts the response.",
      "evidence": [
        "service-a/src/main/java/com/acme/PriceService.java:42",
        "automation/tests/checkout/discount.spec.ts:18"
      ]
    }
  ],
  "shouldRun": [],
  "newScenarios": [
    {
      "title": "Reject an expired discount at checkout",
      "source": "PAY-812",
      "reason": "The acceptance criteria add a new expiry rule; no existing test references it."
    }
  ],
  "risks": [
    {
      "severity": "high",
      "category": "selector-drift",
      "source": "service-b/src/pages/checkout/ApplyButton.tsx:12",
      "automation": "automation/tests/checkout/discount.spec.ts:31",
      "action": "Update the locator from `data-testid=apply` to `data-testid=apply-discount`."
    }
  ],
  "fullRegression": false,
  "fullRegressionReasons": [],
  "unknowns": []
}
```

Full-regression triggers:

- A path listed in `policy.fullRegression`.
- A changed file listed in `mapping.contracts`.
- Adapter failure or unreadable refs.

The report names a full-regression trigger before the selected tests. The selected tests stay the list to run. File count and mapping coverage are notes, not full-regression triggers. A map that matches most of the suite selects a test only when a signal also matches.

#### Fid Coder integration

1. **Multi-repo workspace.** The config already lists repos relative to the workspace. The app validates them and shows each repo's branch/status in the Context view. A separate workspace manifest is optional; the release-impact config can be the source of truth.
2. **`impact_analyze` tool.** Add `src/tools/release/impact.ts`. It runs the engine and returns compact JSON, so the agent does not need shell for git.
   ```ts
   type ImpactAnalyzeArgs = {
     configPath?: string;
     prod?: string;
     candidate?: string;
     dryRun?: boolean;
   };

   // Tool name: impact_analyze. Returns compact JSON facts.
   impactAnalyze(args: ImpactAnalyzeArgs): Promise<string>;
   ```
3. **Analyst tool profile.** Add `analyst` to `AgentToolProfile` and `toolsForAgent()`. It includes explore, read, git, and `impact_analyze`, plus report writing limited to `artifacts/`. It cannot edit source or automation repos.
4. **Agent preset.** A portable JSON file without secrets, memory, or transcripts:
   ```json
   {
     "name": "Release Impact Analyst",
     "description": "Compares prod and candidate refs and selects the regression tests to run.",
     "toolProfile": "analyst",
     "configFile": ".release-impact/config.json",
     "systemPromptFile": ".release-impact/prompt.md",
     "readOnlyRepos": true
   }
   ```
   The prompt is generic:
   ```text
   Read the release-impact config and run impact_analyze.
   Use only the engine output and the files it names.
   Cite path:line for every claim. Never invent test IDs.
   Mark missing evidence as Needs review.
   If a full-regression trigger matches, put it first.
   Never edit source or automation repos.
   ```
5. **Config doctor.** A Settings action or CLI command validates paths, refs, adapters, mappings, and output directories before the first run.
6. **Report panel.** Add `src/renderer/components/desk/ImpactReport.tsx` to render the latest report. Show the full-regression banner, must-run list, gaps, risks, and a copy-selection button.
7. **Routine.** A nightly routine, or a manual run after a release branch or tag is cut, can execute the analysis and notify with the must-run count and full-regression flag.
8. **Standalone CLI.** The engine has no Electron imports, so CI can run the same logic without the app.

#### Standalone CLI

```text
release-impact init --template playwright-java
release-impact doctor --config .release-impact/config.json
release-impact analyze --config .release-impact/config.json --dry-run
release-impact analyze --config .release-impact/config.json --prod <sha> --candidate <sha>
release-impact explain TC-1042 --config .release-impact/config.json
```

- `init` writes a config, prompt, preset, and `artifacts/` directory from a stack template.
- `doctor` validates the config and prints repo, ref, test, and mapping counts.
- `analyze --dry-run` runs the deterministic pipeline only; no model call.
- `analyze` writes the deterministic facts, a report draft, and the selection. The Fid Coder agent performs the AI review and writes the final `impact-report.md`; the CLI itself does not call Copilot.
- Exit codes: `0` report written, `2` invalid config, `3` full regression recommended or adapter failure.

Package the engine as a dependency-free Node ESM folder or an internal npm package. This fits the internal “no installer” constraint: a team copies the folder or runs `node dist/cli/release-impact.js`.

#### Onboarding instructions for another team

1. Create a workspace folder with their repos:
   ```text
   team-workspace/
     repos/
       service-a/
       service-b/
       service-c/
       automation/
     .release-impact/
       config.json
       prompt.md
       agent-preset.json
     artifacts/
   ```
2. Copy the engine folder or install the internal package.
3. Run `release-impact init --template <stack>` or copy an example config.
4. Edit `repos`, refs, `framework`, `testGlobs`, `caseIdPattern`, `mapping`, and `policy`.
5. Run `release-impact doctor`. Fix every error before continuing.
6. Run `release-impact analyze --dry-run` against the previous release. Check the change counts and candidate tests.
7. In Fid Coder, create an agent from `agent-preset.json`, select `team-workspace/` as the workspace, and save. Until presets ship, create the agent manually with the analyst profile and paste `prompt.md`.
8. Send the first prompt. The agent runs `impact_analyze`, reviews the candidates, and writes `artifacts/impact-report.md`.
9. Seed 20–30 explicit mappings for critical areas. Add more from missed failures after each release.
10. Wire `artifacts/selected-tests.json` into CI.

Same stack: under an hour plus mapping time. New test framework: 1–2 days for a proper adapter; the generic adapter bridges in the meantime.

#### Technical implementation

Suggested modules:

| Path | Purpose |
|---|---|
| `src/shared/release-impact/types.ts` | Serializable config, change, inventory, candidate, and report types |
| `src/shared/release-impact/score.ts` | Pure scoring and tiering |
| `src/shared/release-impact/report.ts` | Pure Markdown and JSON rendering |
| `src/main/release-impact/config.ts` | Read and validate config, resolve paths |
| `src/main/release-impact/collect.ts` | Git refs, diffs, classification, signal extraction |
| `src/main/release-impact/index.ts` | Engine orchestration |
| `src/main/release-impact/adapters/` | Playwright, generic, and later framework adapters |
| `src/tools/release/impact.ts` | `impact_analyze` tool |
| `src/cli/release-impact.ts` | CLI entry; no Electron imports |
| `src/renderer/components/desk/ImpactReport.tsx` | Report panel |

Core types:

```ts
export type RepoRole = "source" | "automation" | "contract";
export type TestTier = "must" | "should" | "optional";

export type RepoConfig = {
  id: string;
  path: string;
  role: RepoRole;
  language?: string;
  framework?: string;
  adapterPath?: string;
  testGlobs?: string[];
  caseIdPattern?: string;
  prod?: string;
  candidate?: string;
};

export type ImpactConfig = {
  schemaVersion: number;
  team?: string;
  releaseManifest?: string;
  repos: RepoConfig[];
  ignore?: string[];
  mapping?: { explicit?: MappingRule[]; contracts?: ContractRule[] };
  policy?: ImpactPolicy;
  outputs: ImpactOutputs;
  jira?: { enabled?: boolean; projectKeys?: string[] };
};
```

Implementation rules:

- **No Electron imports in the engine.** The CLI and CI must be able to import it.
- Use `runArgv` with argument arrays; never build a shell string.
- Validate refs with `git rev-parse --verify` before use.
- Every repo path must resolve inside the workspace.
- Cap diff output per file and total bytes; write full diffs to disk, not into the prompt.
- Use `git show <ref>:<path>` for candidate file contents when the working tree is not checked out at the candidate ref.
- Cache the test inventory by automation SHA.
- The AI review is a separate step. `impact_analyze` returns facts; the agent writes the report.
- The analyst profile needs a write guard so `file_write` is limited to `artifacts/`.
- Config is data, not code. Reject secret-looking values (`ghp_`, `github_pat_`, `eyJ`) and never print tokens.
- Add unit tests for config validation and scoring, integration tests with fixture git repos, and a live test with a fixture workspace.

Build wiring:

- Add `src/cli` to `tsconfig.main.json` or a small `tsconfig.cli.json`.
- Add `"release-impact": "node dist/cli/release-impact.js"` to `package.json`.
- Keep the CLI output deterministic so CI can diff it.

#### What is config vs code

| Concern | Team config | Engine code |
|---|---|---|
| Repo count, names, paths | Yes | — |
| Prod and candidate refs | Yes | Resolver |
| Test framework | Adapter id | Adapter implementation |
| Test globs and case IDs | Yes | Generic discovery |
| Code-to-test mapping | Yes | Matcher |
| Full-regression policy | Yes | Evaluator |
| Coverage thresholds | Yes | Scorer |
| Report sections | Template override | Renderer |
| CI selection format | Yes | Formatter |
| Model choice | Agent setting | Not in engine |
| Secrets | App settings | Secret store |

#### Done when

- Another team copies the template, edits config, runs `doctor`, imports `agent-preset.json`, and gets a report without code changes.
- The engine contains no repo names, branch names, test paths, or team names.
- `analyze --dry-run` works offline against a previous release.
- A full-regression trigger is always surfaced before selected tests.
- The selected-tests JSON is accepted by at least one CI runner.
- The report cites source and automation evidence for every must-run test and risk.

#### Risks

- **Mapping is domain knowledge.** Config cannot invent it. Start with explicit rules and improve from actual failures.
- **Test IDs must exist.** Without stable IDs or tags, selection falls back to file and test names.
- **Prod needs a source ref.** If only a binary exists, tag the source commit during the release.
- **The model is the last mile.** The deterministic engine selects; the agent explains and finds gaps.
- **Full regression is the safety net.** Never let a low-confidence selection gate a release alone.
- **Custom adapters execute code.** Keep them opt-in and path-validated.

#### Delivery phases

1. Config, collect, index, and `analyze --dry-run` CLI — 2–3 days.
2. Matcher, report, and the Playwright adapter — 2–3 days.
3. Fid Coder `impact_analyze` tool, analyst profile, preset, and report panel — 2–3 days.
4. Additional adapters, Jira enrichment, and the feedback loop — ongoing.

---

## Sequencing

Core cockpit:

```text
1. Chats ──► 2. Approvals ──► 3. Routines 2.0 ──► 4. Attachments ──► 5. MCP
```

Use-case track (independent):

```text
Config + CLI ──► Matcher + report ──► Fid Coder preset ──► More adapters
```

- **#1 first** because #3 and #4 attach to a thread; doing it later means reworking them.
- **#2 before #5** because third-party tools need a real permission gate.
- **#4 is independent** and can run in parallel with #3.
- **#6 can start now.** Its standalone CLI does not require #1–#5. The Fid Coder integration benefits from #2 (approvals) and multi-repo workspace support.
- Rough total: 4–5 weeks for the core track, plus 2–3 weeks for a reusable #6 v1.

## Deferred / next wave

- **Global full-text search and command palette.** After #1, the conversations table makes SQLite FTS cheap. `Ctrl+K` currently only filters agents.
- **Subagent delegation.** Generalize `explore_code` into named subagents with their own prompts, tool subsets, and budgets. A strong harness bet after approvals and threads.
- **Confluence and Jira writes.** Native follow-ups if MCP does not cover the internal Atlassian setup.
- **Per-hunk diff accept/reject and a change timeline.** The desk currently shows only the latest turn.
- **Usage and activity dashboard.** The app shows one quota bar, not history.
- **Portable auto-update or LAN remote UI.** Relevant to the internal distribution constraint, but not a top-five workflow feature.

## Open decisions

1. **Memory scope after threads.** Recommendation: keep the rolling summary on the agent as long-term facts, and treat each thread transcript as task context.
2. **Routine threads.** Recommendation: one thread per routine, so history stays readable.
3. **Attachment storage.** Recommendation: copy files into app data so history survives source changes; never edit the source file.
4. **MCP transport.** Recommendation: local stdio only in the first release.
5. **Approval policy scope.** Recommendation: per-agent rules with a global default.
6. **Release-impact packaging.** Recommendation: one dependency-free CLI plus a thin Fid Coder tool, so CI and the app share the same engine.
7. **Custom adapters.** Recommendation: built-in adapters only by default; load a team adapter only with `policy.allowCustomAdapters` and a validated relative path.
8. **AI boundary.** Recommendation: the engine selects deterministically; the agent reviews and explains. The CLI never calls Copilot.

## Recorded ideas (30 October 2026)

Five smaller ideas, written down beside the sequenced roadmap. They are notes. Building one does not start the others, and none of them replace items 1–5 above.

| Idea | What it adds | Touches |
|---|---|---|
| A | One missed routine runs when the app opens | The missed-run policy inside Routines 2.0 |
| B | Scroll and a key press in the local browser | New browser tools |
| C | One text file on the next message | A narrow slice of Composer attachments |
| D | A failed or skipped routine on the agent row | The status Routines 2.0 would also surface |
| E | Show a changed file in Explorer | The diff already on the Agent Desk |

### A. Catch one missed routine when the app opens

**Status:** Idea

#### Problem

A routine stores `next_run_at`, and `node-cron` fires only while Fid Coder is open. A 9:00 routine does nothing if the app was closed at 9:00.

#### What it would do

On `Scheduler.reload()`, after the cron jobs are registered, each enabled routine whose `nextRunAt` is already due calls the existing `fire()` once. That path already writes the following next run, skips with "agent busy" when a turn is in progress, and raises a toast when the routine asks for one. Startup does not wait for the Copilot turn.

One catch-up per routine. A week of missed mornings becomes a single run, then the next future slot. Two due routines on the same agent follow the current busy rule: the second is skipped while the first turn is still running.

#### Where it would land

- A due check next to `nextRunIso` in `src/main/routines/cron.ts`.
- The call from `Scheduler.reload()`.
- A unit test: a past `nextRunAt` is due, a future one is not, a paused routine is not. No Electron process and no live Copilot call.

#### Done when

An enabled routine whose next run passed while the app was closed runs once on the next open, and its stored next run moves to the following slot.

### B. Scroll and press a key in the local browser

**Status:** Idea

#### Problem

Browser tools are `browser_navigate`, `browser_snapshot`, `browser_click`, and `browser_type`. Long pages and menus stop there. The desk image is a preview for the person at the PC. Copilot turns are text, so the model keeps reading the accessibility snapshot.

#### What it would do

Two tools on the browser and all profiles:

- `browser_scroll` moves the page, or one selector from the snapshot, up or down. Default about 600 pixels, cap 2000.
- `browser_press` sends one key from a fixed list: Enter, Escape, Tab, the arrows, PageDown, PageUp, Home, and End.

Tool descriptions carry the rule. The system message stays as it is. No new Jira write tool.

#### Where it would land

- Handlers on the existing browser manager.
- Tool definitions in `src/tools/browser/browser.ts`.
- A pure key-list helper with a unit test.

#### Done when

A browser agent can scroll a long page and send Escape or Tab, and the snapshot that follows reflects the new view.

### C. Attach one text file to the next message

**Status:** Idea

#### Problem

The composer is a textarea. A log, a note, or a specification has to be pasted by hand. Item 4 above is the full attachment design, including images, several files, and files stored with the message. This idea is the small version.

#### What it would do

A paperclip attaches one text file. The renderer reads it locally, refuses a binary file when it sees a NUL byte, and clips the text to 8,000 characters so the fresh-session window of 12,000 characters still has room for the recent thread. A chip shows the file name and can be removed before send.

The saved user message stays one text message: a fenced copy of the file, then the typed text. Memory, the transcript, and routines need no new column. A browser agent can attach a file the same way. The model does not gain a tool that reads outside the workspace.

#### Where it would land

- A clip-and-fence helper in `src/shared`, with a unit test.
- The composer in `ChatView`. One file. Images stay out of this idea.

#### Done when

A text file appears in the sent message, a binary file is refused, and reloading the transcript still shows the fenced copy.

### D. Show a failed or skipped routine on the agent

**Status:** Idea

#### Problem

`routines.last_status` is already written (`ok`, `skipped: agent busy`, `error: …`). The Routines dialog shows it. The desk row shows the schedule and the next run. The sidebar shows last chat activity.

#### What it would do

The desk routine line uses the same status label as the dialog. The sidebar meta line shows that status when the newest routine run was skipped or failed. A completed routine stays quiet on the sidebar row. No new table, badge, or inbox. The inbox in Routines 2.0 can replace this later.

#### Where it would land

- Move `routineStatusLabel` and its tone from `RoutinesDialog` into `src/renderer/lib/routine-schedule.ts`.
- `listAgents` adds the status of the routine with the latest `last_run_at`.
- The desk routine row and the sidebar meta line render it.

#### Done when

A skipped or failed routine is visible on the agent row and on the desk without opening the Routines dialog.

### E. Reveal a changed file in Explorer

**Status:** Idea

#### Problem

A change row opens the diff, and the diff can revert that file. There is no way to open the file's folder from the desk.

#### What it would do

**Show in folder** on the diff. The main process loads that change's path, checks it is still inside the agent workspace, and calls `shell.showItemInFolder`. Shell edits stay untracked, as they are today.

#### Where it would land

- One IPC channel in `src/shared/channels.ts`, the preload inline list, `src/main/ipc/index.ts`, and `FidApi`.
- The button in the existing diff actions.

#### Done when

Show in folder highlights the changed file in Explorer, and a path outside the workspace is refused.

## Related documents

- `AGENTS.md` — repository conventions and where new code belongs.
- `docs/memory.md` — how transcripts and the rolling summary work.
- `docs/build-exe.md` — packaging and distribution.
