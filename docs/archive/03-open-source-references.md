# Open Source Projects to Reference

These projects are useful for learning patterns. **Do not clone them as the starting point** if you want a clean from-scratch POC. Study their agent loops, Playwright usage, and Electron structure instead.

## Recommended References

| Project | Why It’s Useful | Link | Notes |
|---------|------------------|------|-------|
| **browser-use** | Best open-source browser agent loop (Playwright + LLM tool calling) | [github.com/browser-use/browser-use](https://github.com/browser-use/browser-use) | Study the agent loop and action/tool design. Python-based, but patterns transfer. |
| **WebPilot** | Electron + Playwright MCP + multi-LLM desktop agent | [github.com/ahamSel/WebPilot](https://github.com/ahamSel/WebPilot) | Closest Electron + Playwright desktop example. |
| **Promptwright** | Electron desktop agent that turns natural language into Playwright actions | [github.com/testronai/promptwright](https://github.com/testronai/promptwright) | Good for UI + agent execution flow ideas. |
| **Echo Q Bot** | Simple Electron + Playwright + multi-LLM structure | Search GitHub for `echo-q-bot` | Lightweight reference for Electron main/renderer split. |
| **Rakazo** | Architecture inspiration for persistent agents, memory, and routines | [github.com/elie222/rakazo](https://github.com/elie222/rakazo) | **Ignore** its Docker/sandbox computer layer. Take the agent + routine concepts only. |

## How to Use These Projects

1. **Scaffold fresh** — Let Grok Build create a new Electron + Vite + React + TypeScript project.
2. **Study patterns**:
   - Agent tool-calling loop from **browser-use**
   - Playwright persistent context / profile handling
   - Electron main process ↔ renderer communication
   - Simple agent CRUD UI
3. **Do not copy**:
   - Rakazo’s Docker-based computer / sandbox system
   - Heavy monorepo setups unless you specifically need them later
   - Cloud/remote browser providers

## Quick Links Summary

- browser-use: https://github.com/browser-use/browser-use
- WebPilot: https://github.com/ahamSel/WebPilot
- Promptwright: https://github.com/testronai/promptwright
- Rakazo: https://github.com/elie222/rakazo

## Suggested Learning Order

1. Skim **browser-use** for how an LLM decides browser actions.
2. Look at **WebPilot** or **Promptwright** for Electron + Playwright desktop structure.
3. Use **Rakazo** only for inspiration on agent memory and routines (not infrastructure).
