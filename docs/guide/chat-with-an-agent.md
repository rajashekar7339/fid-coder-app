# Chat with an agent

The conversation is the center column. Messages stream in as the agent works, tool calls are grouped into one card, and every reply is saved locally with the agent.

![A conversation with a user message, a three-step tool card, and a formatted reply with bullets and a risk note.](images/chat-tool-steps.png)

## Send a message

Type in the composer and press **Enter**. Use **Shift+Enter** for a new line. The composer grows up to eight lines.

The agent can only answer after Copilot is connected. If the composer says "Sign in to Copilot to chat", open **Settings → Copilot** and sign in.

## Follow the work

While the agent runs, its current tool step is highlighted in the open tool card. Finished tool calls stay in the card above the reply. Expand it to see each call and a short summary of its result.

The conversation is saved in the local SQLite database. When Fid Coder rebuilds a Copilot session, it sends the last 30 messages, clipped to 12,000 characters, so the agent has recent context.

## Use the model picker

The model picker sits in the composer. **Auto** lets Copilot choose the model for the agent. Choose another model when the agent is idle; the picker is disabled while a turn is running.

## Stop a turn

Press the square stop button while the agent is working. Any partial reply is kept in the conversation with a note that the turn stopped.

## Approve a command

The shell tool pauses before a delete, a git push, or a download. A compact approval card appears in the conversation with the command, working folder, and risk, plus an auto-deny countdown. Choose **Reject**, **Always deny**, **Always allow**, or **Allow once**.

**Always allow** and **Always deny** save a rule for that exact command and folder. Deny rules win over allow rules. Ending the turn or ignoring the countdown rejects the command. Every request and decision appears in the Agent Desk approvals history, and saved rules are under **Settings → Safety**.

## Recall an older issue

Ask the agent what you worked on earlier, or name the issue. It can search the saved conversation by text or date, read only the matching turn, load a small date window, or read the first message. The full transcript stays on this PC; the agent loads what it needs instead of replaying the whole conversation.

## Ask for a diagram

Ask for a flow, process, or architecture picture. The agent answers with a Mermaid block, and the app draws it as a diagram with zoom, horizontal scroll, and a **Source** toggle. A reply that already contains ASCII art still shows as text under a **Diagram** label.

> **Tip:** Hover a reply and choose **Copy**, or use the copy button on a code block or diagram.
