import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { diffLines } from "../shared/diff";
import type { ChangeSet, FileChangeSummary, FileDiff } from "../shared/types";
import { MAX_CHECKPOINT_BYTES } from "../tools/types";
import type { AppDatabase, FileChangeRecord } from "./db";

const MAX_CURRENT_BYTES = 8_000_000;
const MAX_DIFF_CHARS = 400_000;
const MAX_FILES_PER_TURN = 40;
const RETENTION_DAYS = 14;

export class CheckpointStore {
  private readonly db: AppDatabase;
  private readonly root: string;

  constructor(db: AppDatabase, root: string) {
    this.db = db;
    this.root = root;
    fs.mkdirSync(this.root, { recursive: true });
    this.prune();
  }

  capture(
    agentId: string,
    turnId: string,
    file: string,
    previous: Buffer | null,
    existed = previous !== null,
  ): void {
    const agent = this.db.getAgent(agentId);
    if (!agent?.workspaceDir) return;
    const relative = relativeInside(agent.workspaceDir, file);
    if (!relative) return;
    if (this.db.getFileChangeByPath(turnId, relative)) return;
    if (this.db.listFileChanges(turnId).length >= MAX_FILES_PER_TURN) return;

    const id = crypto.randomUUID();
    let beforeRef: string | null = null;
    let note: string | null = null;
    if (previous) {
      if (previous.length > MAX_CHECKPOINT_BYTES) {
        note = "File was too large to checkpoint.";
      } else if (previous.includes(0)) {
        note = "File is binary; diff and revert are unavailable.";
      } else {
        const dir = path.join(this.root, agentId, turnId);
        fs.mkdirSync(dir, { recursive: true });
        beforeRef = path.join(dir, `${id}.before`);
        fs.writeFileSync(beforeRef, previous);
      }
    } else if (existed) {
      note = "File was too large or not a regular file to checkpoint.";
    }

    this.db.addFileChange({
      id,
      turnId,
      agentId,
      path: relative,
      kind: existed ? "update" : "create",
      beforeRef,
      beforeSize: previous?.length ?? 0,
      note,
    });
  }

  finalizeTurn(agentId: string, turnId: string): void {
    const agent = this.db.getAgent(agentId);
    if (!agent?.workspaceDir) return;
    for (const file of this.db.listFileChanges(turnId)) {
      const absolute = safeJoin(agent.workspaceDir, file.path);
      if (!absolute) continue;
      let current: Buffer | null = null;
      try {
        if (fs.statSync(absolute).isFile()) current = fs.readFileSync(absolute);
      } catch {
        current = null;
      }
      if (!current) {
        this.db.finalizeFileChange(file.id, null, 0, 0, 0, "File is missing.");
        continue;
      }
      if (current.length > MAX_CURRENT_BYTES) {
        this.db.finalizeFileChange(file.id, null, current.length, 0, 0, "File became too large to track.");
        continue;
      }
      let additions = 0;
      let deletions = 0;
      if (!current.includes(0)) {
        let before = "";
        let canDiff = true;
        if (file.beforeRef) {
          try {
            before = fs.readFileSync(file.beforeRef, "utf8");
          } catch {
            canDiff = false;
          }
        } else if (file.kind === "update") {
          canDiff = false;
        }
        if (canDiff) {
          const stats = diffLines(before, current.toString("utf8"));
          additions = stats.additions;
          deletions = stats.deletions;
        }
      }
      this.db.finalizeFileChange(file.id, hash(current), current.length, additions, deletions, null);
    }
  }

  latest(agentId: string): ChangeSet | null {
    const set = this.db.latestChangeSet(agentId);
    if (!set) return null;
    const agent = this.db.getAgent(agentId);
    const files: FileChangeSummary[] = set.files.slice(0, MAX_FILES_PER_TURN).map((file) => ({
      id: file.id,
      path: file.path,
      kind: file.kind,
      additions: file.additions,
      deletions: file.deletions,
      revertible: agent?.workspaceDir ? this.hasRestorePoint(agent.workspaceDir, file) : false,
      note: file.note,
    }));
    return {
      turnId: set.turn.id,
      startedAt: set.turn.startedAt,
      source: set.turn.source,
      status: set.turn.status,
      files,
    };
  }

  diff(id: string): FileDiff {
    const file = this.db.getFileChange(id);
    if (!file) throw new Error("Change not found");
    const agent = this.db.getAgent(file.agentId);
    let before: string | null = null;
    let after: string | null = null;
    let truncated = false;
    if (file.beforeRef) {
      const text = readCapped(file.beforeRef);
      if (text) {
        before = text.text;
        truncated = truncated || text.truncated;
      }
    }
    if (agent?.workspaceDir) {
      const absolute = safeJoin(agent.workspaceDir, file.path);
      if (absolute) {
        const text = readCapped(absolute);
        if (text) {
          after = text.text;
          truncated = truncated || text.truncated;
        }
      }
    }
    return {
      id: file.id,
      path: file.path,
      kind: file.kind,
      before,
      after,
      truncated,
      revertible: agent?.workspaceDir ? this.hasRestorePoint(agent.workspaceDir, file) : false,
      note: file.note,
    };
  }

  revert(id: string): void {
    const file = this.db.getFileChange(id);
    if (!file) throw new Error("Change not found");
    const agent = this.db.getAgent(file.agentId);
    if (!agent?.workspaceDir) throw new Error("This agent has no workspace folder.");
    const absolute = safeJoin(agent.workspaceDir, file.path);
    if (!absolute) throw new Error("The file is outside the workspace.");
    this.checkRestorable(file, absolute);
    this.restore(file, absolute);
    this.removeCheckpoint(file);
    this.db.deleteFileChange(file.id);
  }

  revertTurn(turnId: string): void {
    const turn = this.db.getTurn(turnId);
    if (!turn) throw new Error("Turn not found");
    const files = this.db.listFileChanges(turnId);
    if (files.length === 0) return;
    const agent = this.db.getAgent(turn.agentId);
    if (!agent?.workspaceDir) throw new Error("This agent has no workspace folder.");

    const targets = files.map((file) => {
      const absolute = safeJoin(agent.workspaceDir!, file.path);
      if (!absolute) throw new Error(`${file.path} is outside the workspace.`);
      this.checkRestorable(file, absolute);
      return { file, absolute };
    });

    for (const target of targets.reverse()) {
      this.restore(target.file, target.absolute);
      this.removeCheckpoint(target.file);
      this.db.deleteFileChange(target.file.id);
    }
  }

  clearAgent(agentId: string): void {
    this.db.deleteAgentChanges(agentId);
    fs.rmSync(path.join(this.root, agentId), { recursive: true, force: true });
  }

  private hasRestorePoint(workspaceDir: string, file: FileChangeRecord): boolean {
    if (file.afterHash === null) return false;
    if (file.kind === "update" && !file.beforeRef) return false;
    return Boolean(safeJoin(workspaceDir, file.path));
  }

  private checkRestorable(file: FileChangeRecord, absolute: string): void {
    if (file.afterHash === null) throw new Error(`${file.path} was not fully recorded and cannot be reverted.`);
    if (file.kind === "update" && !file.beforeRef) {
      throw new Error(`${file.path} has no saved checkpoint and cannot be reverted.`);
    }
    let current: Buffer | null = null;
    try {
      if (fs.statSync(absolute).isFile()) current = fs.readFileSync(absolute);
    } catch {
      current = null;
    }
    if (file.kind === "create" && !current) return;
    if (!current) throw new Error(`${file.path} is missing. Revert it manually.`);
    if (hash(current) !== file.afterHash) {
      throw new Error(`${file.path} changed after this turn. Revert it manually.`);
    }
  }

  private restore(file: FileChangeRecord, absolute: string): void {
    const exists = fs.existsSync(absolute);
    if (file.kind === "create") {
      if (exists) fs.rmSync(absolute, { force: true });
      return;
    }
    if (!file.beforeRef) throw new Error(`${file.path} has no saved checkpoint.`);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.copyFileSync(file.beforeRef, absolute);
  }

  private removeCheckpoint(file: FileChangeRecord): void {
    if (!file.beforeRef) return;
    fs.rmSync(file.beforeRef, { force: true });
  }

  private prune(): void {
    try {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
      for (const turn of this.db.pruneTurns(cutoff)) {
        fs.rmSync(path.join(this.root, turn.agentId, turn.id), { recursive: true, force: true });
      }
    } catch (error) {
      console.error("Failed to prune checkpoints", error);
    }
  }
}

function relativeInside(root: string, file: string): string | null {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function safeJoin(root: string, relative: string): string | null {
  const absolute = path.resolve(root, relative);
  const inside = path.relative(path.resolve(root), absolute);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return absolute;
}

function hash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function readCapped(file: string): { text: string; truncated: boolean } | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const bytesToRead = Math.min(stat.size, MAX_DIFF_CHARS * 4);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(file, "r");
    let bytes = 0;
    try {
      bytes = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    } finally {
      fs.closeSync(fd);
    }
    const data = buffer.subarray(0, bytes);
    if (data.includes(0)) return null;
    const text = data.toString("utf8");
    if (text.length <= MAX_DIFF_CHARS) {
      return { text, truncated: stat.size > bytesToRead };
    }
    return { text: text.slice(0, MAX_DIFF_CHARS), truncated: true };
  } catch {
    return null;
  }
}
