export type Starter = {
  id: "architecture" | "flow" | "review" | "troubleshoot";
  label: string;
  hint: string;
  prompt: string;
};

export const WORKSPACE_STARTERS: Starter[] = [
  {
    id: "architecture",
    label: "Explain architecture",
    hint: "Read the repo and describe the main parts.",
    prompt:
      "Explain the architecture of this repository. Start with a one-paragraph overview, then list the entry points and main modules with path:line references. Use a Mermaid flowchart if it helps.",
  },
  {
    id: "flow",
    label: "Trace a flow",
    hint: "Follow one runtime path with a sequence diagram.",
    prompt:
      "Trace the main request or startup flow through this repository. Use a Mermaid sequenceDiagram, then add numbered steps with path:line references.",
  },
  {
    id: "review",
    label: "Review architecture",
    hint: "Find coupling, boundary, and test risks.",
    prompt: "/skills architecture-review review this repository",
  },
  {
    id: "troubleshoot",
    label: "Troubleshoot an error",
    hint: "Paste a stack trace or log after the prompt.",
    prompt: "Troubleshoot this error:\n\n",
  },
];
