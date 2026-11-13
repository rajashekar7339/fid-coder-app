import askModeImage from "../../../docs/guide/images/ask-mode.png";
import enhancePromptImage from "../../../docs/guide/images/enhance-prompt.png";
import projectMapImage from "../../../docs/guide/images/project-map.png";
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
    summary: "Sidebar, conversation, Agent Desk, composer, and the shortcuts worth knowing.",
    readMinutes: 3,
    file: "the-cockpit.md",
  },
  {
    id: "chat-with-an-agent",
    title: "Chat with an agent",
    group: "Using Fid Coder",
    summary:
      "Send messages, improve a draft, follow tool steps, read token and credit usage, switch models, stop a turn, and approve deletes, pushes, and downloads.",
    readMinutes: 6,
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
    summary: "Create a routine that runs once or repeats, and get a Windows notification when it needs you.",
    readMinutes: 4,
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
      "Browse or upload skills, check their versions, and use one with /skills. A used skill can be loaded again when a later message needs it.",
    readMinutes: 5,
    file: "use-skills.md",
  },
  {
    id: "connect-accounts",
    title: "Connect Copilot, GitHub, and Jira",
    group: "Using Fid Coder",
    summary: "Sign in to Copilot and add optional GitHub and Jira tokens that stay on this PC.",
    readMinutes: 4,
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
  "ask-mode.png": askModeImage,
  "enhance-prompt.png": enhancePromptImage,
  "project-map.png": projectMapImage,
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
