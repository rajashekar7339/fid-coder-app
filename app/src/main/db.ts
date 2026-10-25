import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import type {
  Agent,
  AgentInput,
  Message,
  MessageRole,
  Routine,
  RoutineInput,
  RoutinePatch,
} from "../shared/types";

type AgentRow = {
  id: string;
  name: string;
  system_prompt: string;
  workspace_dir: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  agent_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
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

const OLD_TODO_PROMPT = `You are a To Do List agent on this Windows machine. Track the user's tasks with task_list, task_add, and task_complete. Store a due time as an ISO date-time in dueAt when the user gives one. Keep replies short. When asked what is due, list open tasks and their times. Do not invent tasks.`;

const TODO_PROMPT = `You are a To Do List agent on this Windows machine. Help the user plan what to do. Keep replies short. Do not invent tasks. You do not have a saved task list.`;

const OLD_REMINDER_PROMPT = "List my open tasks, especially anything due today, and give me a short reminder.";

const REMINDER_PROMPT = "Give a short planning reminder for today. A saved task list is not available.";

const JIRA_PROMPT = `You are a JIRA agent. Use the local browser tools browser_navigate, browser_snapshot, browser_click, and browser_type. The browser profile belongs to this agent and keeps logins. Read browser_snapshot before every click or type. Choose Playwright selectors from the snapshot, such as role=link[name="Boards"] or text=Assigned to me. Report only what the page shows. Do not type passwords unless the user explicitly provides one in this conversation.`;

const GIT_PROMPT = `You are a Git pull request review agent. Work only inside the workspace folder. Use shell_run for git and gh, and file_read to inspect files. Summarize the change, name the risks, and quote file paths. Do not push, force-push, or change git config. If no workspace folder is set, ask the user to pick one in the agent editor.`;

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(file: string) {
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
        system_prompt TEXT NOT NULL,
        workspace_dir TEXT,
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
    `);
    const now = new Date().toISOString();
    this.db.prepare("UPDATE agents SET system_prompt = ?, updated_at = ? WHERE system_prompt = ?").run(TODO_PROMPT, now, OLD_TODO_PROMPT);
    this.db.prepare("UPDATE routines SET prompt = ?, updated_at = ? WHERE prompt = ?").run(REMINDER_PROMPT, now, OLD_REMINDER_PROMPT);
  }

  private seed(): void {
    const count = this.db.prepare("SELECT COUNT(*) AS c FROM agents").get() as { c: number };
    if (count.c > 0) return;

    const now = new Date().toISOString();
    const insertAgent = this.db.prepare(
      `INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    );
    const todoId = crypto.randomUUID();
    this.db.exec("BEGIN");
    try {
      insertAgent.run(todoId, "To Do List", TODO_PROMPT, now, now);
      insertAgent.run(crypto.randomUUID(), "JIRA Agent", JIRA_PROMPT, now, now);
      insertAgent.run(crypto.randomUUID(), "Git PR Review", GIT_PROMPT, now, now);
      this.db
        .prepare(
          `INSERT INTO routines (
            id, agent_id, name, prompt, cron, enabled, notify, last_run_at, next_run_at, last_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, 1, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          todoId,
          "Morning task reminder",
          REMINDER_PROMPT,
          "0 9 * * 1-5",
          now,
          now,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listAgents(): Agent[] {
    const rows = this.db.prepare("SELECT * FROM agents ORDER BY name COLLATE NOCASE").all() as AgentRow[];
    return rows.map(mapAgent);
  }

  getAgent(id: string): Agent | null {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRow | undefined;
    return row ? mapAgent(row) : null;
  }

  createAgent(input: AgentInput): Agent {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.name.trim(), input.systemPrompt, emptyToNull(input.workspaceDir), now, now);
    return this.requireAgent(id);
  }

  updateAgent(id: string, input: AgentInput): Agent {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE agents
         SET name = ?, system_prompt = ?, workspace_dir = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(input.name.trim(), input.systemPrompt, emptyToNull(input.workspaceDir), now, id);
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

  addMessage(agentId: string, role: MessageRole, content: string): Message {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO messages (id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, agentId, role, content, createdAt);
    return { id, agentId, role, content, createdAt };
  }

  listRoutines(agentId: string): Routine[] {
    const rows = this.db
      .prepare("SELECT * FROM routines WHERE agent_id = ? ORDER BY name COLLATE NOCASE")
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
    systemPrompt: row.system_prompt,
    workspaceDir: row.workspace_dir,
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

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
