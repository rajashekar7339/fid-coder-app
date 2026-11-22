export const SIDEBAR_WIDTH = 276;
export const MIN_CHAT_WIDTH = 420;
export const MIN_WORKSPACE_WIDTH = 480;
export const WORKSPACE_WIDTH_KEY = "fid.workspaceWidth";

/** The widest the right panel can be while the chat keeps its minimum width. */
export function maxWorkspaceWidth(viewportWidth: number): number {
  return Math.max(MIN_WORKSPACE_WIDTH, viewportWidth - SIDEBAR_WIDTH - MIN_CHAT_WIDTH);
}

export function clampWorkspaceWidth(value: number, viewportWidth: number): number {
  if (!Number.isFinite(value)) return MIN_WORKSPACE_WIDTH;
  return Math.max(MIN_WORKSPACE_WIDTH, Math.min(maxWorkspaceWidth(viewportWidth), Math.round(value)));
}
