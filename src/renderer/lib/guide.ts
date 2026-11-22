/// <reference types="vite/client" />

import allRoutinesImage from "../../../docs/guide/images/all-routines.png";
import agentFactsImage from "../../../docs/guide/images/agent-facts.png";
import approvalRulesImage from "../../../docs/guide/images/approval-rules.png";
import askModeImage from "../../../docs/guide/images/ask-mode.png";
import confluenceSettingsImage from "../../../docs/guide/images/confluence-settings.png";
import datadogSettingsImage from "../../../docs/guide/images/datadog-settings.png";
import deepseekSettingsImage from "../../../docs/guide/images/deepseek-settings.png";
import enhancePromptImage from "../../../docs/guide/images/enhance-prompt.png";
import messageActionsImage from "../../../docs/guide/images/message-actions.png";
import needsYouImage from "../../../docs/guide/images/needs-you.png";
import projectMapImage from "../../../docs/guide/images/project-map.png";
import queueWhileRunningImage from "../../../docs/guide/images/queue-while-running.png";
import routineHistoryImage from "../../../docs/guide/images/routine-history.png";
import sidebarWorkingImage from "../../../docs/guide/images/sidebar-working.png";
import skillsLibraryImage from "../../../docs/guide/images/skills-library.png";
import skillsUseImage from "../../../docs/guide/images/skills-use.png";

export type GuideArticle = {
  id: string;
  title: string;
  group: string;
  summary: string;
  readMinutes: number;
  body: string;
};

type GuideSource = Omit<GuideArticle, "body"> & { file: string };

const SOURCES: GuideSource[] = [
  {
    id: "create-your-first-agent",
    title: "Create your first agent",
    group: "Start here",
    summary: "Set the name, instructions, tools, and workspace for a new local teammate.",
    readMinutes: 4,
    file: "create-your-first-agent.md",
  },
  {
    id: "the-cockpit",
    title: "The cockpit at a glance",
    group: "Start here",
    summary: "Search, pin, and archive agents, clear Needs you, then use the conversation, Agent Desk, and shortcuts.",
    readMinutes: 4,
    file: "the-cockpit.md",
  },
  {
    id: "chat-with-an-agent",
    title: "Chat with an agent",
    group: "Using Fid Coder",
    summary:
      "Send messages, queue a follow-up while a turn runs, edit or delete a chat message, save a fact, improve a draft, follow tool steps, answer a question, hand the browser back for sign-in, read token and credit usage, switch models, stop a turn, and approve deletes, pushes, and downloads.",
    readMinutes: 9,
    file: "chat-with-an-agent.md",
  },
  {
    id: "understand-a-codebase",
    title: "Understand a codebase",
    group: "Using Fid Coder",
    summary:
      "Use Ask mode, starter prompts, the project map, architecture review, flow diagrams, and clickable file evidence without making code changes.",
    readMinutes: 6,
    file: "understand-a-codebase.md",
  },
  {
    id: "create-a-routine",
    title: "Create a routine",
    group: "Using Fid Coder",
    summary:
      "Create a routine that runs once or repeats while Fid Coder is open, see every routine in one list, and let it do the work or only look and report. A slot that passes while the app is closed does not run.",
    readMinutes: 6,
    file: "create-a-routine.md",
  },
  {
    id: "work-in-a-workspace",
    title: "Work in a workspace",
    group: "Using Fid Coder",
    summary: "Give a developer agent a folder, native file and git tools, and a workspace brief.",
    readMinutes: 5,
    file: "work-in-a-workspace.md",
  },
  {
    id: "use-skills",
    title: "Use skills on demand",
    group: "Using Fid Coder",
    summary:
      "Browse, upload, or save a skill from chat, check versions, and use one with /skills. A used skill can be loaded again when a later message needs it.",
    readMinutes: 6,
    file: "use-skills.md",
  },
  {
    id: "connect-accounts",
    title: "Connect Copilot, DeepSeek, GitHub, Jira, and Confluence",
    group: "Using Fid Coder",
    summary: "Sign in to Copilot or add a DeepSeek key, then add optional GitHub, Jira, and Confluence tokens that stay on this PC.",
    readMinutes: 5,
    file: "connect-accounts.md",
  },
];

const DOCS = import.meta.glob("../../../docs/guide/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

const IMAGES = import.meta.glob("../../../docs/guide/images/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const EXPLICIT_IMAGES: Record<string, string> = {
  "all-routines.png": allRoutinesImage,
  "agent-facts.png": agentFactsImage,
  "approval-rules.png": approvalRulesImage,
  "ask-mode.png": askModeImage,
  "confluence-settings.png": confluenceSettingsImage,
  "datadog-settings.png": datadogSettingsImage,
  "deepseek-settings.png": deepseekSettingsImage,
  "enhance-prompt.png": enhancePromptImage,
  "message-actions.png": messageActionsImage,
  "needs-you.png": needsYouImage,
  "project-map.png": projectMapImage,
  "queue-while-running.png": queueWhileRunningImage,
  "routine-history.png": routineHistoryImage,
  "sidebar-working.png": sidebarWorkingImage,
  "skills-library.png": skillsLibraryImage,
  "skills-use.png": skillsUseImage,
};

function docFor(file: string): string {
  const entry = Object.entries(DOCS).find(
    ([path]) => path === `../../../docs/guide/${file}` || path.endsWith(`/${file}`),
  );
  return entry?.[1] ?? "";
}

export const GUIDE_ARTICLES: GuideArticle[] = SOURCES.map(({ file, ...article }) => ({
  ...article,
  body: docFor(file),
}));

export function guideImage(path: string): string {
  const name = path.split("/").pop() ?? path;
  const explicit = EXPLICIT_IMAGES[name];
  if (explicit) return explicit;
  const entry = Object.entries(IMAGES).find(([key]) => key.endsWith(`/${name}`));
  return entry?.[1] ?? path;
}
