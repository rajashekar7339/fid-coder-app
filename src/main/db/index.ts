import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { AUTO_MODEL_ID, normalizeModelId } from "../../shared/model";
import { normalizeToolProfile } from "../../shared/tool-profile";
import type {
  Agent,
  AgentInput,
  FileChangeKind,
  Message,
  MessageRole,
  PlanStep,
  PlanView,
  Routine,
  RoutineInput,
  RoutinePatch,
} from "../../shared/types";

type AgentRow = {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  workspace_dir: string | null;
  model: string | null;
  tool_profile: string | null;
  memory_summary: string | null;
  memory_enabled: number;
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

type MessageRow = {
  id: string;
  agent_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
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

type PlanRow = {
  agent_id: string;
  turn_id: string | null;
  steps: string;
  updated_at: string;
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
  enabled: number;
  notify: number;
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
        memory_summary TEXT NOT NULL DEFAULT '',
        memory_turn_count INTEGER NOT NULL DEFAULT 0,
        memory_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, created_at);

      CREATE TABLE IF NOT EXISTS routines (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        cron TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS plans (
        agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        turn_id TEXT,
        steps TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.ensureAgentModelColumn();
    this.ensureAgentDescriptionColumn();
    this.ensureAgentMemoryColumns();
    this.ensureMessageTurnColumn();
    const addedToolProfile = this.ensureAgentToolProfileColumn();
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

  private ensureMessageTurnColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (columns.some((column) => column.name === "turn_id")) return;
    this.db.exec("ALTER TABLE messages ADD COLUMN turn_id TEXT");
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
    if (count.c > 0) return;

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

  listAgents(): Agent[] {
    const rows = this.db
      .prepare(`${AGENT_SELECT} ORDER BY COALESCE(last_activity_at, a.updated_at) DESC, a.name COLLATE NOCASE`)
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
          id, name, description, system_prompt, workspace_dir, model, tool_profile, memory_enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name.trim(),
        cleanDescription(input.description),
        input.systemPrompt,
        emptyToNull(input.workspaceDir),
        normalizeModelId(input.model),
        normalizeToolProfile(input.toolProfile),
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
             memory_enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name.trim(),
        cleanDescription(input.description),
        input.systemPrompt,
        emptyToNull(input.workspaceDir),
        normalizeModelId(input.model),
        normalizeToolProfile(input.toolProfile),
        input.memoryEnabled ? 1 : 0,
        now,
        id,
      );
    if (result.changes === 0) throw new Error("Agent not found");
    return this.requireAgent(id);
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

  listMessages(agentId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(agentId) as MessageRow[];
    return rows.map(mapMessage);
  }

  addMessage(agentId: string, role: MessageRole, content: string, turnId: string | null = null): Message {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO messages (id, agent_id, role, content, created_at, turn_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, agentId, role, content, createdAt, turnId);
    return { id, agentId, role, content, createdAt };
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

  deleteFileChange(id: string): void {
    this.db.prepare("DELETE FROM file_changes WHERE id = ?").run(id);
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

  getPlan(agentId: string): PlanView | null {
    const row = this.db.prepare("SELECT * FROM plans WHERE agent_id = ?").get(agentId) as PlanRow | undefined;
    if (!row) return null;
    return {
      agentId,
      turnId: row.turn_id,
      steps: readPlanSteps(row.steps),
      updatedAt: row.updated_at,
    };
  }

  setPlan(agentId: string, turnId: string | null, steps: PlanStep[]): PlanView {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO plans (agent_id, turn_id, steps, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, steps = excluded.steps, updated_at = excluded.updated_at`,
      )
      .run(agentId, turnId, JSON.stringify(steps), updatedAt);
    return { agentId, turnId, steps, updatedAt };
  }

  clearPlan(agentId: string): void {
    this.db.prepare("DELETE FROM plans WHERE agent_id = ?").run(agentId);
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
          id, agent_id, name, prompt, cron, enabled, notify, last_run_at, next_run_at, last_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.agentId,
        input.name.trim(),
        input.prompt,
        input.cron.trim(),
        input.enabled ? 1 : 0,
        input.notify ? 1 : 0,
        nextRunAt,
        now,
        now,
      );
    return this.requireRoutine(id);
  }

  updateRoutine(id: string, patch: RoutinePatch, nextRunAt: string | null): Routine {
    const current = this.requireRoutine(id);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE routines
         SET name = ?, prompt = ?, cron = ?, enabled = ?, notify = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name?.trim() || current.name,
        patch.prompt ?? current.prompt,
        patch.cron?.trim() || current.cron,
        (patch.enabled ?? current.enabled) ? 1 : 0,
        (patch.notify ?? current.notify) ? 1 : 0,
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
    memorySummary: row.memory_summary ?? "",
    memoryEnabled: row.memory_enabled !== 0,
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
  };
}

function mapRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    prompt: row.prompt,
    cron: row.cron,
    enabled: row.enabled === 1,
    notify: row.notify === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
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

function readPlanSteps(raw: string): PlanStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is PlanStep => {
    if (!item || typeof item !== "object") return false;
    const step = item as { text?: unknown; status?: unknown };
    return (
      typeof step.text === "string" &&
      (step.status === "pending" || step.status === "in_progress" || step.status === "done")
    );
  });
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
