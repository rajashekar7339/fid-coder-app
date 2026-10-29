export interface BrowserControl {
  navigate(agentId: string, url: string): Promise<string>;
  snapshot(agentId: string): Promise<string>;
  click(agentId: string, selector: string): Promise<string>;
  type(agentId: string, selector: string, text: string, submit: boolean): Promise<string>;
}

export type ToolContext = {
  agentId: string;
  workspaceDir: string | null;
  model?: string;
  browser: BrowserControl;
  githubPat: string | null;
  jiraToken: string | null;
  jiraSite: string | null;
  explore?: (question: string) => Promise<string>;
};

export type AppTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<string>;
};
