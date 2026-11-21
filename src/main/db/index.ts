import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import {
  DATADOG_AGENT_DESCRIPTION,
  DATADOG_AGENT_NAME,
  DATADOG_AGENT_PROMPT,
} from "../../shared/datadog";
import { AUTO_MODEL_ID, normalizeModelId } from "../../shared/model";
import { normalizeToolProfile } from "../../shared/tool-profile";
import {
  approvalRuleMatches,
  isApprovalMatcher,
  normalizeApprovalMatch,
} from "../../shared/approval";
import { parseMessageAttachments } from "../../shared/attachments";
import type {
  Agent,
  AgentInput,
  AgentPlacement,
  ApprovalDecision,
  ApprovalKind,
  ApprovalRecord,
  ApprovalRule,
  ApprovalRuleInput,
  ApprovalSource,
  Fact,
  FileChangeKind,
  Message,
  MessageAttachment,
  MessageRole,
  Routine,
  RoutineInput,
  RoutineOverview,
  RoutinePatch,
  RoutineRun,
  RoutineRunTrigger,
  TokenUsage,
} from "../../shared/types";
import type { StoredInboxRow } from "../../shared/inbox";
import { RUN_LIST_LIMIT } from "../../shared/routine-runs";
type AgentRow = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  workspace_dir: string | null;
  model: string | null;
  tool_profile: string | null;
  read_only: number | null;
  memory_summary: string | null;
  memory_enabled: number;
  pinned: number | null;
  archived: number | null;
  last_activity_at: string | null;
  next_routine_at: string | null;
  created_at: string;
  updated_at: string;
};

const AGENT_SELECT = `
  SELECT
    a.*,
    (SELECT MAX(m.created_at) FROM messages m WHERE m.agent_id = a.id) AS last_activity_at,
    (
      SELECT MIN(r.next_run_at) FROM routines r
      WHERE r.agent_id = a.id AND r.enabled = 1 AND r.next_run_at IS NOT NULL
    ) AS next_routine_at
  FROM agents a
`;

const APPROVAL_RULE_SELECT = `
  SELECT r.*, a.name AS agent_name
  FROM approval_rules r
  LEFT JOIN agents a ON a.id = r.agent_id
`;

type MessageRow = {
  id: string;
  agent_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  turn_id: string | null;
  turn_source?: string | null;
  turn_started_at?: string | null;
  turn_ended_at?: string | null;
  usage: string | null;
  attachments: string | null;
};

type TurnRow = {
  id: string;
  agent_id: string;
  source: string;
  started_at: string;
  ended_at: string | null;
  status: string | null;
};

type FileChangeRow = {
  id: string;
  turn_id: string;
  agent_id: string;
  path: string;
  kind: string;
  before_ref: string | null;
  before_size: number;
  after_size: number;
  after_hash: string | null;
  additions: number;
  deletions: number;
  note: string | null;
  created_at: string;
};

type ApprovalRow = {
  id: string;
  agent_id: string;
  agent_name?: string;
  turn_id: string | null;
  kind: string;
  command: string;
  cwd: string;
  reason: string;
  decision: string;
  source: string | null;
  created_at: string;
  decided_at: string | null;
};

type ApprovalRuleRow = {
  id: string;
  agent_id: string | null;
  agent_name?: string | null;
  kind: string;
  decision: string;
  match: string;
  matcher: string;
  cwd: string;
  created_at: string;
};

export type WorkspaceMapRecord = {
  cacheKey: string;
  text: string;
  generatedAt: string;
};

type WorkspaceMapRow = {
  cache_key: string;
  text: string;
  generated_at: string;
};

export type TurnRecord = {
  id: string;
  agentId: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  status: string | null;
};

export type FileChangeRecord = {
  id: string;
  turnId: string;
  agentId: string;
  path: string;
  kind: FileChangeKind;
  beforeRef: string | null;
  beforeSize: number;
  afterSize: number;
  afterHash: string | null;
  additions: number;
  deletions: number;
  note: string | null;
  createdAt: string;
};

export type ChangeSetRecord = {
  turn: TurnRecord;
  files: FileChangeRecord[];
};

type RoutineRow = {
  id: string;
  agent_id: string;
  name: string;
  prompt: string;
  cron: string;
  once: number;
  run_at: string | null;
  enabled: number;
  notify: number;
  read_only: number | null;
  consecutive_failures: number | null;
  last_run_at: string | null;
  next_run_at: string | null;
  last_status: string | null;
  created_at: string;
  updated_at: string;
};

const SEEDED_TODO_PROMPTS = [
  `You are a To Do List agent on this Windows machine. Track the user's tasks with task_list, task_add, and task_complete. Store a due time as an ISO date-time in dueAt when the user gives one. Keep replies short. When asked what is due, list open tasks and their times. Do not invent tasks.`,
  `You are a To Do List agent on this Windows machine. Help the user plan what to do. Keep replies short. Do not invent tasks. You do not have a saved task list.`,
];

const OLD_JIRA_NAME = "Jira Agent";
const JIRA_NAME = "JIRA Agent";
const JIRA_DESCRIPTION = "Jira teammate";
const GIT_DESCRIPTION = "Code reviewer";

const OLD_JIRA_PROMPT = `You are a Jira agent. Use the local browser tools browser_navigate, browser_snapshot, browser_click, and browser_type. The browser profile belongs to this agent and keeps logins. Read browser_snapshot before every click or type. Choose Playwright selectors from the snapshot, such as role=link[name="Boards"] or text=Assigned to me. Report only what the page shows. Do not type passwords unless the user explicitly provides one in this conversation.`;

const PREVIOUS_JIRA_PROMPT = `You are a JIRA agent. Use the local browser tools browser_navigate, browser_snapshot, browser_click, and browser_type. The browser profile belongs to this agent and keeps logins. Read browser_snapshot before every click or type. Choose Playwright selectors from the snapshot, such as role=link[name="Boards"] or text=Assigned to me. Report only what the page shows. Do not type passwords unless the user explicitly provides one in this conversation.`;

const API_JIRA_PROMPT = `You are a JIRA agent. Read the saved Jira site with jira_search, jira_issue, and jira_myself before using the browser. Use the browser only when the user needs the page itself. Read browser_snapshot before every click or type. Choose Playwright selectors from the snapshot, such as role=link[name="Boards"] or text=Assigned to me. Report only what the tools or the page show. Do not type passwords unless the user explicitly provides one in this conversation.`;

const JIRA_PROMPT = `You are a JIRA agent. Use jira_search, jira_issue, and jira_myself when they are available. Use the browser when they are not, when the user asks for the browser, or when a Jira tool fails. Read browser_snapshot before every click or type. Choose Playwright selectors from the snapshot, such as role=link[name="Boards"] or text=Assigned to me. Report only what the tools or the page show. Do not type passwords unless the user explicitly provides one in this conversation.`;

const OLD_GIT_NAME = "Git PR Review";
const GIT_NAME = "GIT PR Review";

const OLD_GIT_PROMPT = `You are a Git pull request review agent. Work only inside the workspace folder. Use shell_run for git and gh, and file_read to inspect files. Summarize the change, name the risks, and quote file paths. Do not push, force-push, or change git config. If no workspace folder is set, ask the user to pick one in the agent editor.`;

const GIT_PROMPT = `You are a Git pull request review agent. Work only inside the workspace folder. Use git_status, git_diff, git_log, gh_pr_view, and gh_pr_diff for the review. Use file_read, read_many, and search_text to inspect code. Use explore_code when you need to find where a change lives. Summarize the change, name the risks, and quote file paths. Do not push, force-push, or change git config. If no workspace folder is set, ask the user to pick one in the agent editor.`;

// The removed Codebase guide template saved this sentence into agent prompts.
const OLD_GUIDE_PERMISSION =
  " Do not edit files or run commands. If the user wants a change, tell them to switch to Code.";

export class AppDatabase {
  private readonly db: DatabaseSync;
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
    this.seed();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL,
        workspace_dir TEXT,
        model TEXT NOT NULL DEFAULT 'auto',
        tool_profile TEXT NOT NULL DEFAULT 'all',
        read_only INTEGER NOT NULL DEFAULT 0,
        memory_summary TEXT NOT NULL DEFAULT '',
        memory_turn_count INTEGER NOT NULL DEFAULT 0,
        memory_enabled INTEGER NOT NULL DEFAULT 1,
        pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        usage TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron TEXT NOT NULL,
        once INTEGER NOT NULL DEFAULT 0,
        run_at TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        notify INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_run_at TEXT,
        last_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due_at TEXT,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_turns_agent ON turns(agent_id, started_at);

      CREATE TABLE IF NOT EXISTS file_changes (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        kind TEXT NOT NULL,
        before_ref TEXT,
        before_size INTEGER NOT NULL DEFAULT 0,
        after_size INTEGER NOT NULL DEFAULT 0,
        after_hash TEXT,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(turn_id, path)
      );
      CREATE INDEX IF NOT EXISTS idx_file_changes_agent ON file_changes(agent_id);

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        turn_id TEXT,
        kind TEXT NOT NULL,
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        reason TEXT NOT NULL,
        decision TEXT NOT NULL DEFAULT 'pending',
        source TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_agent ON approvals(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS approval_rules (
        id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        decision TEXT NOT NULL,
        match TEXT NOT NULL,
        matcher TEXT NOT NULL DEFAULT 'exact',
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approval_rules_agent ON approval_rules(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL,
        used_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, skill_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_skills_agent ON agent_skills(agent_id, used_at);

      CREATE TABLE IF NOT EXISTS routine_runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        turn_id TEXT,
        output TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_routine_runs_agent ON routine_runs(agent_id, started_at);

      CREATE TABLE IF NOT EXISTS inbox_items (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT,
        snooze_until TEXT,
        UNIQUE(kind, ref_id)
      );
      CREATE INDEX IF NOT EXISTS idx_inbox_agent ON inbox_items(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS agent_facts (
        id TEXT PRIMARY KEY,
        agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_facts_agent ON agent_facts(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS workspace_maps (
        workspace_dir TEXT PRIMARY KEY,
        cache_key TEXT NOT NULL,
        text TEXT NOT NULL,
        generated_at TEXT NOT NULL
      );
    `);
    this.db
      .prepare("UPDATE approvals SET decision = 'deny', source = 'aborted', decided_at = ? WHERE decision = 'pending'")
      .run(new Date().toISOString());
    this.ensureAgentModelColumn();
    this.ensureAgentDescriptionColumn();
    this.ensureAgentMemoryColumns();
    this.ensureMessageTurnColumn();
    this.ensureMessageUsageColumn();
    this.ensureMessageAttachmentsColumn();
    const addedToolProfile = this.ensureAgentToolProfileColumn();
    this.ensureAgentReadOnlyColumn();
    this.ensureAgentPlacementColumns();
    this.ensureRoutineOnceColumns();
    this.ensureRoutineGuardColumns();
    this.ensureRoutineRunModeColumn();
    this.ensureApprovalRuleColumns();
    const now = new Date().toISOString();
    this.db.prepare("UPDATE agents SET name = ?, updated_at = ? WHERE name = ?").run(JIRA_NAME, now, OLD_JIRA_NAME);
    this.db.prepare("UPDATE agents SET name = ?, updated_at = ? WHERE name = ?").run(GIT_NAME, now, OLD_GIT_NAME);
    if (addedToolProfile) {
      this.db.prepare("UPDATE agents SET tool_profile = ? WHERE name = ? AND tool_profile = ?").run("browser", JIRA_NAME, "all");
      this.db.prepare("UPDATE agents SET tool_profile = ? WHERE name = ? AND tool_profile = ?").run("developer", GIT_NAME, "all");
    }
    for (const prompt of [OLD_JIRA_PROMPT, PREVIOUS_JIRA_PROMPT, API_JIRA_PROMPT]) {
      this.db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE system_prompt = ?").run(JIRA_PROMPT, now, prompt);
    }
    this.db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE system_prompt = ?").run(GIT_PROMPT, now, OLD_GIT_PROMPT);
    this.db
      .prepare(
        "UPDATE agents SET system_prompt = TRIM(REPLACE(system_prompt, ?, '')), updated_at = ? WHERE instr(system_prompt, ?) > 0",
      )
      .run(OLD_GUIDE_PERMISSION, now, OLD_GUIDE_PERMISSION);
    this.db.prepare("UPDATE agents SET description = ? WHERE name = ? AND description = ''").run(JIRA_DESCRIPTION, JIRA_NAME);
    this.db.prepare("UPDATE agents SET description = ? WHERE name = ? AND description = ''").run(GIT_DESCRIPTION, GIT_NAME);
    this.removeSeededTodo();
  }

  private ensureAgentModelColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (columns.some((column) => column.name === "model")) return;
    this.db.exec("ALTER TABLE agents ADD COLUMN model TEXT NOT NULL DEFAULT 'auto'");
  }

  private ensureAgentDescriptionColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (columns.some((column) => column.name === "description")) return;
    this.db.exec("ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  private ensureAgentMemoryColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("memory_summary")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN memory_summary TEXT NOT NULL DEFAULT ''");
    }
    if (!names.has("memory_turn_count")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN memory_turn_count INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("memory_enabled")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1");
    }
  }

  private ensureAgentToolProfileColumn(): boolean {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (columns.some((column) => column.name === "tool_profile")) return false;
    this.db.exec("ALTER TABLE agents ADD COLUMN tool_profile TEXT NOT NULL DEFAULT 'all'");
    return true;
  }

  private ensureAgentReadOnlyColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    if (columns.some((column) => column.name === "read_only")) return;
    this.db.exec("ALTER TABLE agents ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
  }

  private ensureAgentPlacementColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("pinned")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("archived")) {
      this.db.exec("ALTER TABLE agents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0");
    }
  }

  private ensureRoutineOnceColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(routines)").all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("once")) {
      this.db.exec("ALTER TABLE routines ADD COLUMN once INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("run_at")) {
      this.db.exec("ALTER TABLE routines ADD COLUMN run_at TEXT");
    }
  }

  private ensureRoutineGuardColumns(): void {
    const columns = this.db.prepare("PRAGMA table_info(routines)").all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("read_only")) {
      this.db.exec("ALTER TABLE routines ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("consecutive_failures")) {
      this.db.exec("ALTER TABLE routines ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0");
    }
  }

  private ensureRoutineRunModeColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(routine_runs)").all() as { name: string }[];
    if (columns.some((column) => column.name === "read_only")) return;
    this.db.exec("ALTER TABLE routine_runs ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0");
  }

  /**
   * Rebuild the old per-agent, exact-only rules table. SQLite cannot drop the
   * NOT NULL on agent_id in place, and old rows need matcher = 'exact'.
   */
  private ensureApprovalRuleColumns(): void {
    const columns = this.db
      .prepare("PRAGMA table_info(approval_rules)")
      .all() as { name: string; notnull: number }[];
    const agent = columns.find((column) => column.name === "agent_id");
    const hasMatcher = columns.some((column) => column.name === "matcher");
    const uniqueIndex = `CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_rules_unique
      ON approval_rules(COALESCE(agent_id, ''), kind, decision, match, matcher, cwd);`;
    if (hasMatcher && agent && agent.notnull === 0) {
      this.db.exec(uniqueIndex);
      return;
    }
    const matcher = hasMatcher ? "matcher" : "'exact'";
    this.db.exec("BEGIN");
    try {
      this.db.exec(`
        DROP TABLE IF EXISTS approval_rules_new;
        CREATE TABLE approval_rules_new (
          id TEXT PRIMARY KEY,
          agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          decision TEXT NOT NULL,
          match TEXT NOT NULL,
          matcher TEXT NOT NULL DEFAULT 'exact',
          cwd TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO approval_rules_new (id, agent_id, kind, decision, match, matcher, cwd, created_at)
          SELECT id, agent_id, kind, decision, match, ${matcher}, cwd, created_at FROM approval_rules;
        DROP TABLE approval_rules;
        ALTER TABLE approval_rules_new RENAME TO approval_rules;
        CREATE INDEX IF NOT EXISTS idx_approval_rules_agent ON approval_rules(agent_id, created_at);
        ${uniqueIndex}
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureMessageTurnColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (columns.some((column) => column.name === "turn_id")) return;
    this.db.exec("ALTER TABLE messages ADD COLUMN turn_id TEXT");
  }

  private ensureMessageUsageColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (columns.some((column) => column.name === "usage")) return;
    this.db.exec("ALTER TABLE messages ADD COLUMN usage TEXT");
  }

  private ensureMessageAttachmentsColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (columns.some((column) => column.name === "attachments")) return;
    this.db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }

  private removeSeededTodo(): void {
    const placeholders = SEEDED_TODO_PROMPTS.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT id FROM agents WHERE name = ? AND system_prompt IN (${placeholders})`)
      .all("To Do List", ...SEEDED_TODO_PROMPTS) as { id: string }[];
    const remove = this.db.prepare("DELETE FROM agents WHERE id = ?");
    for (const row of rows) {
      remove.run(row.id);
      if (!/^[0-9a-f-]{36}$/i.test(row.id)) continue;
      fs.rmSync(path.join(path.dirname(this.file), "browser-profiles", row.id), { recursive: true, force: true });
    }
  }

  private seed(): void {
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM agents").get() as { c: number };
    if (count.c === 0) {
      const now = new Date().toISOString();
      const insertAgent = this.db.prepare(
        `INSERT INTO agents (id, name, description, system_prompt, workspace_dir, model, tool_profile, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      );
      this.db.exec("BEGIN");
      try {
        insertAgent.run(crypto.randomUUID(), JIRA_NAME, JIRA_DESCRIPTION, JIRA_PROMPT, AUTO_MODEL_ID, "browser", now, now);
        insertAgent.run(crypto.randomUUID(), GIT_NAME, GIT_DESCRIPTION, GIT_PROMPT, AUTO_MODEL_ID, "developer", now, now);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.ensureDatadogAgent();
  }

  /**
   * Add the Datadog analyst once for existing installs, and move a saved
   * native API prompt to the browser-only contract. The saved flag means
   * deleting the agent later does not bring it back on the next launch.
   */
  private ensureDatadogAgent(): void {
    const existing = this.db
      .prepare("SELECT id, system_prompt FROM agents WHERE name = ?")
      .get(DATADOG_AGENT_NAME) as { id: string; system_prompt: string } | undefined;
    if (existing) {
      // Earlier 21 November builds used native API tools. Move that saved
      // prompt to the browser-only contract without touching custom prompts.
      if (
        existing.system_prompt.includes("datadog_logs_search") ||
        existing.system_prompt.includes("datadog_logs_aggregate")
      ) {
        this.db
          .prepare(
            "UPDATE agents SET system_prompt = ?, tool_profile = ?, updated_at = ? WHERE id = ?",
          )
          .run(DATADOG_AGENT_PROMPT, "datadog", new Date().toISOString(), existing.id);
      }
    }
    if (this.getSetting("datadog_agent_seeded")) return;
    if (!existing) {
      this.createAgent({
        name: DATADOG_AGENT_NAME,
        description: DATADOG_AGENT_DESCRIPTION,
        systemPrompt: DATADOG_AGENT_PROMPT,
        workspaceDir: null,
        model: AUTO_MODEL_ID,
        toolProfile: "datadog",
        memoryEnabled: true,
      });
    }
    this.setSetting("datadog_agent_seeded", "1");
  }

  listAgents(): Agent[] {
    const rows = this.db
      .prepare(
        `${AGENT_SELECT} ORDER BY a.archived ASC, a.pinned DESC, COALESCE(last_activity_at, a.updated_at) DESC, a.name COLLATE NOCASE`,
      )
      .all() as AgentRow[];
    return rows.map(mapAgent);
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare(`${AGENT_SELECT} WHERE a.id = ?`).get(id) as AgentRow | undefined;
    return row ? mapAgent(row) : null;
  }

  createAgent(input: AgentInput): Agent {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO agents (
          id, name, description, system_prompt, workspace_dir, model, tool_profile, read_only, memory_enabled,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        cleanDescription(input.description),
        input.systemPrompt,
        emptyToNull(input.workspaceDir),
        normalizeModelId(input.model),
        normalizeToolProfile(input.toolProfile),
        input.readOnly === true ? 1 : 0,
        input.memoryEnabled ? 1 : 0,
        now,
        now,
      );
    return this.requireAgent(id);
  }

  updateAgent(id: string, input: AgentInput): Agent {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE agents
         SET name = ?, description = ?, system_prompt = ?, workspace_dir = ?, model = ?, tool_profile = ?,
             read_only = ?, memory_enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name.trim(),
        cleanDescription(input.description),
        input.systemPrompt,
        emptyToNull(input.workspaceDir),
        normalizeModelId(input.model),
        normalizeToolProfile(input.toolProfile),
        input.readOnly === true ? 1 : 0,
        input.memoryEnabled ? 1 : 0,
        now,
        id,
      );
    if (result.changes === 0) throw new Error("Agent not found");
    return this.requireAgent(id);
  }

  placeAgent(id: string, placement: AgentPlacement): Agent {
    const pinned = placement.pinned === undefined ? null : placement.pinned ? 1 : 0;
    const archived = placement.archived === undefined ? null : placement.archived ? 1 : 0;
    const result = this.db
      .prepare("UPDATE agents SET pinned = COALESCE(?, pinned), archived = COALESCE(?, archived) WHERE id = ?")
      .run(pinned, archived, id);
    if (result.changes === 0) throw new Error("Agent not found");
    return this.requireAgent(id);
  }

  getWorkspaceMap(workspaceDir: string): WorkspaceMapRecord | null {
    const row = this.db
      .prepare("SELECT cache_key, text, generated_at FROM workspace_maps WHERE workspace_dir = ?")
      .get(path.resolve(workspaceDir)) as WorkspaceMapRow | undefined;
    if (!row) return null;
    return { cacheKey: row.cache_key, text: row.text, generatedAt: row.generated_at };
  }

  setWorkspaceMap(workspaceDir: string, cacheKey: string, text: string): WorkspaceMapRecord {
    const generatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO workspace_maps (workspace_dir, cache_key, text, generated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(workspace_dir) DO UPDATE SET
           cache_key = excluded.cache_key,
           text = excluded.text,
           generated_at = excluded.generated_at`,
      )
      .run(path.resolve(workspaceDir), cacheKey, text, generatedAt);
    return { cacheKey, text, generatedAt };
  }

  getMemoryTurnCount(id: string): number {
    const row = this.db.prepare("SELECT memory_turn_count FROM agents WHERE id = ?").get(id) as
      | { memory_turn_count: number }
      | undefined;
    return row?.memory_turn_count ?? 0;
  }

  setMemorySummary(id: string, summary: string, turnCount: number): void {
    this.db
      .prepare("UPDATE agents SET memory_summary = ?, memory_turn_count = ? WHERE id = ?")
      .run(summary, Math.max(0, Math.floor(turnCount)), id);
  }

  clearMemorySummary(id: string): Agent {
    const result = this.db
      .prepare("UPDATE agents SET memory_summary = '', memory_turn_count = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    if (result.changes === 0) throw new Error("Agent not found");
    return this.requireAgent(id);
  }

  deleteAgent(id: string): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  markSkillUsed(agentId: string, skillId: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO agent_skills (agent_id, skill_id, used_at) VALUES (?, ?, ?)")
      .run(agentId, skillId, new Date().toISOString());
  }

  listUsedSkillIds(agentId: string, limit = 8): string[] {
    const rows = this.db
      .prepare(
        "SELECT skill_id FROM agent_skills WHERE agent_id = ? ORDER BY used_at DESC, rowid DESC LIMIT ?",
      )
      .all(agentId, limit) as Array<{ skill_id: string }>;
    return rows.map((row) => row.skill_id);
  }

  listMessages(agentId: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, t.source AS turn_source,
                t.started_at AS turn_started_at, t.ended_at AS turn_ended_at
         FROM messages m
         LEFT JOIN turns t ON t.id = m.turn_id
         WHERE m.agent_id = ?
         ORDER BY m.created_at ASC, m.rowid ASC`,
      )
      .all(agentId) as MessageRow[];
    return rows.map(mapMessage);
  }

  getMessage(id: string): Message | null {
    const row = this.db
      .prepare(
        `SELECT m.*, t.source AS turn_source,
                t.started_at AS turn_started_at, t.ended_at AS turn_ended_at
         FROM messages m
         LEFT JOIN turns t ON t.id = m.turn_id
         WHERE m.id = ?`,
      )
      .get(id) as MessageRow | undefined;
    return row ? mapMessage(row) : null;
  }

  listRecentConversation(agentId: string, limit = 4): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE agent_id = ? AND role IN ('user', 'assistant') ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(agentId, limit) as MessageRow[];
    return rows.reverse().map(mapMessage);
  }

  firstUserMessages(agentId: string, limit = 1): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE agent_id = ? AND role = 'user'
         ORDER BY created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(agentId, clampLimit(limit, 1, 10)) as MessageRow[];
    return rows.map(mapMessage);
  }

  searchMessages(
    agentId: string,
    input: {
      query?: string;
      from?: string;
      to?: string;
      role?: MessageRole | "all";
      limit?: number;
      order?: "asc" | "desc";
    },
  ): Message[] {
    const where = ["agent_id = ?"];
    const params: Array<string | number> = [agentId];
    if (input.role && input.role !== "all") {
      where.push("role = ?");
      params.push(input.role);
    } else if (!input.role) {
      where.push("role IN ('user', 'assistant')");
    }
    if (input.from) {
      where.push("created_at >= ?");
      params.push(input.from);
    }
    if (input.to) {
      where.push("created_at <= ?");
      params.push(input.to);
    }
    const query = input.query?.trim();
    if (query) {
      where.push("content LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(query)}%`);
    }
    const order = input.order === "asc" ? "ASC" : "DESC";
    const limit = clampLimit(input.limit, 20, 50);
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY created_at ${order}, rowid ${order} LIMIT ?`,
      )
      .all(...params, limit) as MessageRow[];
    return rows.map(mapMessage);
  }

  contextMessages(
    agentId: string,
    input: { from?: string; to?: string; limit?: number; includeTools?: boolean },
  ): Message[] {
    return this.searchMessages(agentId, {
      from: input.from,
      to: input.to,
      role: input.includeTools ? "all" : undefined,
      limit: clampLimit(input.limit, 40, 100),
      order: "asc",
    });
  }

  listTurnMessages(agentId: string, turnId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE agent_id = ? AND turn_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(agentId, turnId) as MessageRow[];
    return rows.map(mapMessage);
  }

  addMessage(
    agentId: string,
    role: MessageRole,
    content: string,
    turnId: string | null = null,
    usage: TokenUsage | null = null,
    attachments: MessageAttachment[] | null = null,
  ): Message {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO messages (id, agent_id, role, content, created_at, turn_id, usage, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        agentId,
        role,
        content,
        createdAt,
        turnId,
        usage ? JSON.stringify(usage) : null,
        attachments && attachments.length > 0 ? JSON.stringify(attachments) : null,
      );
    return { id, agentId, role, content, createdAt, turnId, usage, attachments };
  }

  createTurn(agentId: string, source: string): string {
    const id = crypto.randomUUID();
    this.db
      .prepare("INSERT INTO turns (id, agent_id, source, started_at) VALUES (?, ?, ?, ?)")
      .run(id, agentId, source, new Date().toISOString());
    return id;
  }

  finishTurn(id: string, status: string): void {
    this.db
      .prepare("UPDATE turns SET ended_at = ?, status = ? WHERE id = ?")
      .run(new Date().toISOString(), status.slice(0, 200), id);
  }

  getTurn(id: string): TurnRecord | null {
    const row = this.db.prepare("SELECT * FROM turns WHERE id = ?").get(id) as TurnRow | undefined;
    return row ? mapTurn(row) : null;
  }

  getFileChangeByPath(turnId: string, filePath: string): FileChangeRecord | null {
    const row = this.db
      .prepare("SELECT * FROM file_changes WHERE turn_id = ? AND path = ?")
      .get(turnId, filePath) as FileChangeRow | undefined;
    return row ? mapFileChange(row) : null;
  }

  addFileChange(input: {
    id: string;
    turnId: string;
    agentId: string;
    path: string;
    kind: FileChangeKind;
    beforeRef: string | null;
    beforeSize: number;
    note: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO file_changes (
          id, turn_id, agent_id, path, kind, before_ref, before_size, created_at, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.turnId,
        input.agentId,
        input.path,
        input.kind,
        input.beforeRef,
        input.beforeSize,
        new Date().toISOString(),
        input.note,
      );
  }

  finalizeFileChange(id: string, afterHash: string | null, afterSize: number, additions: number, deletions: number, note: string | null): void {
    this.db
      .prepare(
        `UPDATE file_changes
         SET after_hash = ?, after_size = ?, additions = ?, deletions = ?, note = COALESCE(?, note)
         WHERE id = ?`,
      )
      .run(afterHash, afterSize, additions, deletions, note, id);
  }

  getFileChange(id: string): FileChangeRecord | null {
    const row = this.db.prepare("SELECT * FROM file_changes WHERE id = ?").get(id) as FileChangeRow | undefined;
    return row ? mapFileChange(row) : null;
  }

  listFileChanges(turnId: string): FileChangeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM file_changes WHERE turn_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(turnId) as FileChangeRow[];
    return rows.map(mapFileChange);
  }

  latestChangeSet(agentId: string): ChangeSetRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM turns t
         WHERE t.agent_id = ?
           AND EXISTS (SELECT 1 FROM file_changes c WHERE c.turn_id = t.id)
         ORDER BY t.started_at DESC
         LIMIT 1`,
      )
      .get(agentId) as TurnRow | undefined;
    if (!row) return null;
    return { turn: mapTurn(row), files: this.listFileChanges(row.id) };
  }

  listChangeSets(agentId: string, limit = 30): ChangeSetRecord[] {
    const capped = Math.max(1, Math.min(50, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM turns t
         WHERE t.agent_id = ?
           AND EXISTS (SELECT 1 FROM file_changes c WHERE c.turn_id = t.id)
         ORDER BY t.started_at DESC
         LIMIT ?`,
      )
      .all(agentId, capped) as TurnRow[];
    return rows.map((row) => ({ turn: mapTurn(row), files: this.listFileChanges(row.id) }));
  }

  deleteFileChange(id: string): void {
    this.db.prepare("DELETE FROM file_changes WHERE id = ?").run(id);
  }

  deleteChatTurns(agentId: string, turnId: string, includeLater: boolean): string[] {
    const target = this.getTurn(turnId);
    if (!target || target.agentId !== agentId) throw new Error("Turn not found");
    const rows = includeLater
      ? (this.db
          .prepare(
            `SELECT id FROM turns
             WHERE agent_id = ? AND rowid >= (SELECT rowid FROM turns WHERE id = ?)`,
          )
          .all(agentId, turnId) as Array<{ id: string }>)
      : [{ id: turnId }];
    const ids = rows.map((row) => row.id);
    const removeMessages = this.db.prepare("DELETE FROM messages WHERE turn_id = ?");
    const removeInbox = this.db.prepare(
      "DELETE FROM inbox_items WHERE kind = 'turn' AND ref_id = ?",
    );
    const removeTurn = this.db.prepare("DELETE FROM turns WHERE id = ?");
    this.db.exec("BEGIN");
    try {
      for (const id of ids) {
        removeMessages.run(id);
        removeInbox.run(id);
        removeTurn.run(id);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return ids;
  }

  deleteAgentChanges(agentId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM file_changes WHERE agent_id = ?").run(agentId);
      this.db.prepare("DELETE FROM turns WHERE agent_id = ?").run(agentId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  pruneTurns(cutoff: string): Array<{ id: string; agentId: string }> {
    const rows = this.db
      .prepare("SELECT id, agent_id FROM turns WHERE started_at < ?")
      .all(cutoff) as Array<{ id: string; agent_id: string }>;
    if (rows.length === 0) return [];
    const remove = this.db.prepare("DELETE FROM turns WHERE id = ?");
    this.db.exec("BEGIN");
    try {
      for (const row of rows) remove.run(row.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return rows.map((row) => ({ id: row.id, agentId: row.agent_id }));
  }

  createApproval(input: {
    id: string;
    agentId: string;
    turnId: string | null;
    kind: ApprovalKind;
    command: string;
    cwd: string;
    reason: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO approvals (id, agent_id, turn_id, kind, command, cwd, reason, decision, source, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
      )
      .run(
        input.id,
        input.agentId,
        input.turnId,
        input.kind,
        input.command,
        input.cwd,
        input.reason,
        new Date().toISOString(),
      );
  }

  resolveApproval(id: string, decision: ApprovalDecision, source: ApprovalSource): void {
    this.db
      .prepare("UPDATE approvals SET decision = ?, source = ?, decided_at = ? WHERE id = ?")
      .run(decision, source, new Date().toISOString(), id);
  }

  listApprovals(agentId: string, limit = 50): ApprovalRecord[] {
    const size = Number.isFinite(limit) ? Math.floor(limit) : 50;
    const rows = this.db
      .prepare(
        `SELECT ap.*, a.name AS agent_name
         FROM approvals ap
         JOIN agents a ON a.id = ap.agent_id
         WHERE ap.agent_id = ?
         ORDER BY ap.created_at DESC, ap.rowid DESC
         LIMIT ?`,
      )
      .all(agentId, Math.max(1, Math.min(200, size))) as ApprovalRow[];
    return rows.map(mapApproval);
  }

  findApprovalRule(agentId: string, kind: ApprovalKind, match: string, cwd: string): ApprovalRule | null {
    const rows = this.db
      .prepare(
        `${APPROVAL_RULE_SELECT}
         WHERE r.kind = ? AND (r.agent_id = ? OR r.agent_id IS NULL)
           AND (r.cwd = ? OR r.cwd = '')`,
      )
      .all(kind, agentId, cwd) as ApprovalRuleRow[];
    return (
      rows
        .map(mapApprovalRule)
        .filter((rule) => approvalRuleMatches(rule, match))
        .sort((left, right) => {
          if (left.decision !== right.decision) return left.decision === "deny" ? -1 : 1;
          if ((left.agentId === null) !== (right.agentId === null)) {
            return left.agentId === null ? 1 : -1;
          }
          return right.createdAt.localeCompare(left.createdAt);
        })[0] ?? null
    );
  }

  private cleanApprovalRuleInput(
    input: ApprovalRuleInput,
  ): { agentId: string | null; match: string; cwd: string } {
    if (input.decision !== "allow" && input.decision !== "deny") {
      throw new Error("Approval rule decision must be allow or deny");
    }
    if (!isApprovalMatcher(input.matcher)) {
      throw new Error("Approval rule match type must be exact or prefix");
    }
    const match = normalizeApprovalMatch(input.match);
    if (!match) throw new Error("Approval rule match is required");
    const agentId = input.agentId?.trim() || null;
    if (agentId && !this.getAgent(agentId)) throw new Error("Agent not found");
    return { agentId, match, cwd: input.cwd.trim() };
  }

  createApprovalRule(input: ApprovalRuleInput): ApprovalRule {
    const { agentId, match, cwd } = this.cleanApprovalRuleInput(input);
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO approval_rules
           (id, agent_id, kind, decision, match, matcher, cwd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        agentId,
        input.kind,
        input.decision,
        match,
        input.matcher,
        cwd,
        createdAt,
      );
    const row = this.db
      .prepare(
        `${APPROVAL_RULE_SELECT}
         WHERE r.agent_id IS ? AND r.kind = ? AND r.decision = ? AND r.match = ?
           AND r.matcher = ? AND r.cwd = ?`,
      )
      .get(
        agentId,
        input.kind,
        input.decision,
        match,
        input.matcher,
        cwd,
      ) as ApprovalRuleRow | undefined;
    if (!row) throw new Error("Could not save the approval rule");
    return mapApprovalRule(row);
  }

  updateApprovalRule(id: string, input: ApprovalRuleInput): ApprovalRule {
    const current = this.getApprovalRule(id);
    if (!current) throw new Error("Approval rule not found");
    const { agentId, match, cwd } = this.cleanApprovalRuleInput(input);
    try {
      this.db
        .prepare(
          `UPDATE approval_rules
           SET agent_id = ?, kind = ?, decision = ?, match = ?, matcher = ?, cwd = ?
           WHERE id = ?`,
        )
        .run(agentId, input.kind, input.decision, match, input.matcher, cwd, id);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new Error("A rule for that command already exists.");
      }
      throw error;
    }
    const updated = this.getApprovalRule(id);
    if (!updated) throw new Error("Could not update the approval rule");
    return updated;
  }

  getApprovalRule(id: string): ApprovalRule | null {
    const row = this.db
      .prepare(`${APPROVAL_RULE_SELECT} WHERE r.id = ?`)
      .get(id) as ApprovalRuleRow | undefined;
    return row ? mapApprovalRule(row) : null;
  }

  listApprovalRules(agentId?: string): ApprovalRule[] {
    const sql = `${APPROVAL_RULE_SELECT}
      ${agentId ? "WHERE r.agent_id = ? OR r.agent_id IS NULL" : ""}
      ORDER BY CASE WHEN r.agent_id IS NULL THEN 0 ELSE 1 END,
        a.name COLLATE NOCASE, r.created_at DESC`;
    const statement = this.db.prepare(sql);
    const rows = (agentId ? statement.all(agentId) : statement.all()) as ApprovalRuleRow[];
    return rows.map(mapApprovalRule);
  }

  deleteApprovalRule(id: string): void {
    this.db.prepare("DELETE FROM approval_rules WHERE id = ?").run(id);
  }

  listRoutines(agentId: string): Routine[] {
    const rows = this.db
      .prepare("SELECT * FROM routines WHERE agent_id = ? ORDER BY enabled DESC, name COLLATE NOCASE")
      .all(agentId) as RoutineRow[];
    return rows.map(mapRoutine);
  }

  listEnabledRoutines(): Routine[] {
    const rows = this.db.prepare("SELECT * FROM routines WHERE enabled = 1").all() as RoutineRow[];
    return rows.map(mapRoutine);
  }

  listAllRoutines(): RoutineOverview[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, a.name AS agent_name
         FROM routines r
         JOIN agents a ON a.id = r.agent_id
         ORDER BY a.name COLLATE NOCASE, r.enabled DESC, r.name COLLATE NOCASE`,
      )
      .all() as Array<RoutineRow & { agent_name: string }>;
    return rows.map((row) => ({ ...mapRoutine(row), agentName: row.agent_name }));
  }

  getRoutine(id: string): Routine | null {
    const row = this.db.prepare("SELECT * FROM routines WHERE id = ?").get(id) as RoutineRow | undefined;
    return row ? mapRoutine(row) : null;
  }

  createRoutine(input: RoutineInput, nextRunAt: string | null): Routine {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO routines (
          id, agent_id, name, prompt, cron, once, run_at, enabled, notify, read_only, consecutive_failures,
          last_run_at, next_run_at, last_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.agentId,
        input.name.trim(),
        input.prompt,
        input.cron.trim(),
        input.once ? 1 : 0,
        input.runAt ?? null,
        input.enabled !== false ? 1 : 0,
        input.notify !== false ? 1 : 0,
        input.readOnly ? 1 : 0,
        nextRunAt,
        now,
        now,
      );
    return this.requireRoutine(id);
  }

  updateRoutine(id: string, patch: RoutinePatch, nextRunAt: string | null): Routine {
    const current = this.requireRoutine(id);
    const now = new Date().toISOString();
    const once = patch.once ?? current.once;
    const runAt = once ? (patch.runAt !== undefined ? patch.runAt : current.runAt) : null;
    const enabling = (patch.enabled ?? current.enabled) && !current.enabled;
    this.db
      .prepare(
        `UPDATE routines
         SET name = ?, prompt = ?, cron = ?, once = ?, run_at = ?, enabled = ?, notify = ?, read_only = ?,
             consecutive_failures = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name?.trim() || current.name,
        patch.prompt ?? current.prompt,
        patch.cron?.trim() || current.cron,
        once ? 1 : 0,
        runAt,
        (patch.enabled ?? current.enabled) ? 1 : 0,
        (patch.notify ?? current.notify) ? 1 : 0,
        (patch.readOnly ?? current.readOnly) ? 1 : 0,
        enabling ? 0 : current.consecutiveFailures,
        nextRunAt,
        now,
        id,
      );
    return this.requireRoutine(id);
  }

  deleteRoutine(id: string): void {
    this.db.prepare("DELETE FROM routines WHERE id = ?").run(id);
  }

  markRoutineRun(id: string, status: string, nextRunAt: string | null): void {
    this.db
      .prepare(
        `UPDATE routines
         SET last_run_at = ?, last_status = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), status.slice(0, 500), nextRunAt, new Date().toISOString(), id);
  }

  startRoutineRun(input: {
    routineId: string;
    agentId: string;
    trigger: RoutineRunTrigger;
    readOnly?: boolean;
  }): RoutineRun {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO routine_runs (id, routine_id, agent_id, trigger, read_only, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
      )
      .run(id, input.routineId, input.agentId, input.trigger, input.readOnly ? 1 : 0, startedAt);
    return this.requireRoutineRun(id);
  }

  setRoutineFailures(id: string, count: number, disable: boolean): Routine {
    const now = new Date().toISOString();
    if (disable) {
      this.db
        .prepare(
          `UPDATE routines
           SET consecutive_failures = ?, enabled = 0, next_run_at = NULL, updated_at = ?
           WHERE id = ?`,
        )
        .run(count, now, id);
    } else {
      this.db
        .prepare("UPDATE routines SET consecutive_failures = ?, updated_at = ? WHERE id = ?")
        .run(count, now, id);
    }
    return this.requireRoutine(id);
  }

  listFacts(agentId: string): Fact[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_facts
         WHERE agent_id = ? OR agent_id IS NULL
         ORDER BY CASE WHEN agent_id IS NULL THEN 1 ELSE 0 END, created_at ASC`,
      )
      .all(agentId) as FactRow[];
    return rows.map(mapFact);
  }

  listAllFacts(): Fact[] {
    const rows = this.db
      .prepare("SELECT * FROM agent_facts ORDER BY created_at ASC")
      .all() as FactRow[];
    return rows.map(mapFact);
  }

  getFact(id: string): Fact | null {
    const row = this.db.prepare("SELECT * FROM agent_facts WHERE id = ?").get(id) as FactRow | undefined;
    return row ? mapFact(row) : null;
  }

  insertFact(input: { agentId: string | null; content: string; enabled: boolean }): Fact {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_facts (id, agent_id, content, source, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'user', ?, ?, ?)`,
      )
      .run(id, input.agentId, input.content, input.enabled ? 1 : 0, now, now);
    const fact = this.getFact(id);
    if (!fact) throw new Error("Could not save the fact");
    return fact;
  }

  updateFact(id: string, patch: { content?: string; enabled?: boolean }): Fact {
    const current = this.getFact(id);
    if (!current) throw new Error("Fact not found");
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE agent_facts SET content = ?, enabled = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.content ?? current.content,
        (patch.enabled ?? current.enabled) ? 1 : 0,
        now,
        id,
      );
    const fact = this.getFact(id);
    if (!fact) throw new Error("Fact not found");
    return fact;
  }

  deleteFact(id: string): Fact {
    const current = this.getFact(id);
    if (!current) throw new Error("Fact not found");
    this.db.prepare("DELETE FROM agent_facts WHERE id = ?").run(id);
    return current;
  }

  finishRoutineRun(
    id: string,
    patch: { status: string; turnId?: string | null; output?: string | null; error?: string | null },
  ): RoutineRun {
    this.db
      .prepare(
        `UPDATE routine_runs
         SET status = ?, ended_at = ?, turn_id = ?, output = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        patch.status.slice(0, 500),
        new Date().toISOString(),
        patch.turnId ?? null,
        patch.output ?? null,
        patch.error ? patch.error.slice(0, 500) : null,
        id,
      );
    return this.requireRoutineRun(id);
  }

  getRoutineRun(id: string): RoutineRun | null {
    const row = this.db
      .prepare(
        `SELECT runs.*, routines.name AS routine_name
         FROM routine_runs runs
         JOIN routines ON routines.id = runs.routine_id
         WHERE runs.id = ?`,
      )
      .get(id) as RoutineRunRow | undefined;
    return row ? mapRoutineRun(row) : null;
  }

  listRoutineRuns(agentId: string, limit = RUN_LIST_LIMIT): RoutineRun[] {
    const rows = this.db
      .prepare(
        `SELECT runs.*, routines.name AS routine_name
         FROM routine_runs runs
         JOIN routines ON routines.id = runs.routine_id
         WHERE runs.agent_id = ?
         ORDER BY runs.started_at DESC
         LIMIT ?`,
      )
      .all(agentId, clampLimit(limit, RUN_LIST_LIMIT, 100)) as RoutineRunRow[];
    return rows.map(mapRoutineRun);
  }

  latestTurn(agentId: string): TurnRecord | null {
    const row = this.db
      .prepare("SELECT * FROM turns WHERE agent_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(agentId) as TurnRow | undefined;
    return row ? mapTurn(row) : null;
  }

  reconcileRoutineRuns(skipIds: ReadonlySet<string> = new Set()): number {
    const rows = this.db
      .prepare("SELECT id, routine_id, agent_id FROM routine_runs WHERE status = 'running'")
      .all() as { id: string; routine_id: string; agent_id: string }[];
    const now = new Date().toISOString();
    let count = 0;
    for (const row of rows) {
      if (skipIds.has(row.id)) continue;
      count += 1;
      this.db
        .prepare(
          `UPDATE routine_runs
           SET status = 'error: interrupted', ended_at = ?, error = ?
           WHERE id = ?`,
        )
        .run(now, "Fid Coder closed during this run.", row.id);
      this.db
        .prepare("UPDATE routines SET last_status = 'error: interrupted', updated_at = ? WHERE id = ? AND last_status = 'running'")
        .run(now, row.routine_id);
      this.addInboxItem({
        agentId: row.agent_id,
        kind: "routine",
        refId: row.id,
        title: this.getRoutine(row.routine_id)?.name ?? "Routine",
        body: "Fid Coder closed during this run.",
      });
    }
    return count;
  }

  pruneRoutineHistory(beforeIso: string): void {
    this.db.prepare("DELETE FROM routine_runs WHERE started_at < ?").run(beforeIso);
    this.db.prepare("DELETE FROM inbox_items WHERE created_at < ?").run(beforeIso);
  }

  addInboxItem(input: { agentId: string; kind: "routine" | "turn"; refId: string; title: string; body: string }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO inbox_items (id, agent_id, kind, ref_id, title, body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        input.agentId,
        input.kind,
        input.refId,
        input.title.slice(0, 120),
        input.body.slice(0, 500),
        new Date().toISOString(),
      );
  }

  listOpenInbox(): StoredInboxRow[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.agent_id, a.name AS agent_name, i.kind, i.title, i.body, i.created_at, i.snooze_until
         FROM inbox_items i
         JOIN agents a ON a.id = i.agent_id
         WHERE i.read_at IS NULL
         ORDER BY i.created_at DESC`,
      )
      .all() as InboxRow[];
    return rows.map(mapInboxRow);
  }

  readInbox(id: string): void {
    const result = this.db
      .prepare("UPDATE inbox_items SET read_at = ? WHERE id = ? AND read_at IS NULL")
      .run(new Date().toISOString(), id);
    if (result.changes === 0 && !this.db.prepare("SELECT id FROM inbox_items WHERE id = ?").get(id)) {
      throw new Error("That inbox item is gone.");
    }
  }

  snoozeInbox(id: string, untilIso: string): void {
    const result = this.db
      .prepare("UPDATE inbox_items SET snooze_until = ? WHERE id = ? AND read_at IS NULL")
      .run(untilIso, id);
    if (result.changes === 0) throw new Error("That inbox item is gone.");
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  private requireAgent(id: string): Agent {
    const agent = this.getAgent(id);
    if (!agent) throw new Error("Agent not found");
    return agent;
  }

  private requireRoutine(id: string): Routine {
    const routine = this.getRoutine(id);
    if (!routine) throw new Error("Routine not found");
    return routine;
  }

  private requireRoutineRun(id: string): RoutineRun {
    const run = this.getRoutineRun(id);
    if (!run) throw new Error("Routine run not found");
    return run;
  }
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    workspaceDir: row.workspace_dir,
    model: readModel(row.model),
    toolProfile: normalizeToolProfile(row.tool_profile),
    readOnly: row.read_only === 1,
    memorySummary: row.memory_summary ?? "",
    memoryEnabled: row.memory_enabled !== 0,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    lastActivityAt: row.last_activity_at,
    nextRoutineAt: row.next_routine_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    agentId: row.agent_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    turnId: row.turn_id ?? null,
    turnSource: row.turn_source ?? null,
    turnStartedAt: row.turn_started_at ?? null,
    turnEndedAt: row.turn_ended_at ?? null,
    usage: parseUsage(row.usage),
    attachments: parseMessageAttachments(row.attachments),
  };
}

function parseUsage(raw: string | null): TokenUsage | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TokenUsage>;
    if (typeof value.inputTokens !== "number" || typeof value.outputTokens !== "number") return null;
    return {
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheReadTokens: value.cacheReadTokens ?? 0,
      cacheWriteTokens: value.cacheWriteTokens ?? 0,
      reasoningTokens: value.reasoningTokens ?? 0,
      modelCalls: value.modelCalls ?? 1,
      model: value.model ?? null,
      isAuto: value.isAuto === true,
      nanoAiu: typeof value.nanoAiu === "number" ? Math.max(0, value.nanoAiu) : 0,
      creditCalls: typeof value.creditCalls === "number" ? Math.max(0, value.creditCalls) : 0,
      creditStatus:
        value.creditStatus === "complete" ||
        value.creditStatus === "partial" ||
        value.creditStatus === "unavailable"
          ? value.creditStatus
          : "unavailable",
    };
  } catch {
    return null;
  }
}

type FactRow = {
  id: string;
  agent_id: string | null;
  content: string;
  source: string;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type RoutineRunRow = {
  id: string;
  routine_id: string;
  agent_id: string;
  routine_name: string;
  trigger: string;
  read_only: number | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  turn_id: string | null;
  output: string | null;
  error: string | null;
};

type InboxRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  snooze_until: string | null;
};

function mapRoutineRun(row: RoutineRunRow): RoutineRun {
  return {
    id: row.id,
    routineId: row.routine_id,
    agentId: row.agent_id,
    routineName: row.routine_name,
    trigger: row.trigger === "manual" ? "manual" : "schedule",
    readOnly: row.read_only === 1,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    turnId: row.turn_id,
    output: row.output,
    error: row.error,
  };
}

function mapInboxRow(row: InboxRow): StoredInboxRow {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    kind: row.kind === "turn" ? "turn" : "routine",
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    snoozeUntil: row.snooze_until,
  };
}

function mapRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    once: row.once === 1,
    runAt: row.run_at,
    enabled: row.enabled === 1,
    notify: row.notify === 1,
    readOnly: row.read_only === 1,
    consecutiveFailures: row.consecutive_failures ?? 0,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFact(row: FactRow): Fact {
  return {
    id: row.id,
    agentId: row.agent_id,
    content: row.content,
    source: "user",
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTurn(row: TurnRow): TurnRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    source: row.source,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
  };
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, numeric));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function mapFileChange(row: FileChangeRow): FileChangeRecord {
  return {
    id: row.id,
    turnId: row.turn_id,
    agentId: row.agent_id,
    path: row.path,
    kind: row.kind === "create" ? "create" : "update",
    beforeRef: row.before_ref,
    beforeSize: row.before_size,
    afterSize: row.after_size,
    afterHash: row.after_hash,
    additions: row.additions,
    deletions: row.deletions,
    note: row.note,
    createdAt: row.created_at,
  };
}

function mapApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name ?? "",
    turnId: row.turn_id,
    kind: readApprovalKind(row.kind),
    command: row.command,
    cwd: row.cwd,
    reason: row.reason,
    decision: readApprovalDecision(row.decision),
    source: readApprovalSource(row.source),
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

function mapApprovalRule(row: ApprovalRuleRow): ApprovalRule {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name ?? "All agents",
    kind: readApprovalKind(row.kind),
    decision: row.decision === "deny" ? "deny" : "allow",
    match: row.match,
    matcher: row.matcher === "prefix" ? "prefix" : "exact",
    cwd: row.cwd,
    createdAt: row.created_at,
  };
}

function readApprovalKind(value: string): ApprovalKind {
  return value === "tool" ? "tool" : "shell";
}

function readApprovalDecision(value: string): "pending" | ApprovalDecision {
  return value === "allow" || value === "deny" ? value : "pending";
}

function readApprovalSource(value: string | null): ApprovalSource | null {
  return value === "user" || value === "rule" || value === "timeout" || value === "aborted" ? value : null;
}

function readModel(value: string | null | undefined): string {
  if (typeof value !== "string") return AUTO_MODEL_ID;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === AUTO_MODEL_ID) return AUTO_MODEL_ID;
  return trimmed;
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanDescription(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}
