---
name: Review architecture
description: Review a codebase's architecture: components, runtime flows, boundaries, coupling, risks, and test gaps. Report only.
version: 1.0.0
---

# Review architecture

Use this skill when the user asks for an architecture review, a system overview, or a judgment about how a codebase is put together. This is not a diff review; use `/review` for a change.

## What to inspect

1. Start with the repository rules, the workspace brief, the manifest, and the top-level folders.
2. Find the entry points: app startup, main process, renderer, CLI, routes, scheduled jobs, and background workers.
3. Read the files that define each component's public boundary. Follow imports only far enough to verify a dependency.
4. Trace two or three important runtime flows end to end. Do not guess a flow from a folder name.
5. Look for the decisions that are hard to change: data ownership, process boundaries, shared state, persistence, and third-party services.

## Report shape

Use these sections, in this order:

1. **System in one paragraph** — what it does and the constraints that shape it.
2. **Components** — a table with Component, Responsibility, Key files, and Depends on.
3. **Key flows** — two or three Mermaid `sequenceDiagram` blocks, each followed by numbered steps with `path:line`.
4. **Boundaries and coupling** — what owns which state, where a change crosses a seam, and which dependencies are implicit.
5. **Risks** — a table with Severity, Evidence (`path:line`), Impact, and What would break.
6. **Test and observability gaps** — what the architecture makes hard to verify, not only which tests are missing.
7. **Unknowns and confidence** — what you could not verify, and whether each conclusion is verified or inferred.

## Rules

- Cite `path:line` for every component, risk, and flow step. If you cannot cite it, mark it inferred or leave it out.
- Keep the component table and risks table short enough to read. Prefer the five most important entries over an exhaustive inventory.
- Use a `flowchart` only for module structure; use `sequenceDiagram` for runtime behavior. Keep node labels short.
- Do not edit files, run shell commands, change git, or use the browser.
- Do not recommend the full test suite as a substitute for an actual risk.
- If the repository is large, state the scope you reviewed instead of implying you read everything.
- End with the three questions a new owner should ask next. Do not end with a list of code changes.
