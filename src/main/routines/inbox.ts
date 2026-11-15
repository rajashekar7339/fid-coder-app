import { buildInbox, type InboxView } from "../../shared/inbox";
import type { ApprovalRequest } from "../../shared/types";
import type { AppDatabase } from "../db";

export function currentInbox(db: AppDatabase, approvals: ApprovalRequest[], now = Date.now()): InboxView {
  return buildInbox(db.listOpenInbox(), approvals, now);
}
