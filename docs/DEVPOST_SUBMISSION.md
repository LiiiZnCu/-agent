# Canvas Relay: Devpost submission draft

## One-line pitch

Canvas Relay is a visual thinking workspace where people and browser agents build the same live canvas, create reusable structured artifacts, and preserve an exportable decision trace together.

## Why WebMCP

Visual collaboration apps normally force agents to guess coordinates, click through menus, or produce text that a human must manually reconstruct. Canvas Relay exposes the board's real concepts through 24 WebMCP tools: hosted murals, separate human and agent access, ideas, questions, actions, clusters, connections, layers, structured artifacts, anchored comments, participants, renewable watch leases, moderation, and decision-trace events.

The agent works through stable structured operations while the person sees and controls every change on the canvas. Both use the same action layer, so there is no hidden agent-only state.

## What people and agents can do together

- A person can set a challenge, move ideas, refine content, vote, connect concepts, and add explicit constraints.
- Multiple named agents can join with visible roles such as Explorer, Critic, and Synthesizer.
- Agents can create and organize visual elements, then compile the strongest options into typed tables, cards, checklists, matrices, or custom artifacts.
- Everyone can read the same participant list and shared contribution timeline.
- People and agents can leave reviewable comments on any element; every anchored note also appears in the global conversation.
- The agent that creates a session becomes its moderator and can mute or reactivate another participant through a private capability, rather than trusting a visible ID.
- Agents can renew a watch lease, poll changes globally or for selected components, and stop automatically when the session closes.
- A GPT can create an online mural, return a separate human URL, and issue one private capability URL per invited agent.
- Every mural has a UUID, portable board-plus-trace import/export, and a dedicated URL that can stay open as a separate synchronized instance.
- The finished decision trace can be exported as JSON, Markdown, or CSV with the final board snapshot.

## Implementation

Canvas Relay uses the imperative WebMCP API through `document.modelContext.registerTool`, with a compatibility fallback to `navigator.modelContext`. Every tool has a narrow JSON Schema, bounded inputs, stable element IDs, structured results, and read/write annotations. Artifact Spec 1.0 is also published as machine-readable JSON Schema.

The app is React + Vite with React Flow. It is offline-first: boards and the active trace are written to browser `localStorage`, then automatically synchronized to a tiny Express + Drizzle + SQLite backend when available. There are no accounts, API keys, containers, or external services.

## Demo video outline (under 3 minutes)

1. **0:00-0:20 — Problem and promise.** Show the canvas and explain that agents usually cannot manipulate the semantic structure of a visual workspace reliably.
2. **0:20-0:45 — WebMCP surface.** Open the Agent panel and show the 24 registered tools, including hosted-mural, invitation, artifact, comment, layering, watch, recording, and moderation operations.
3. **0:45-1:25 — Agent builds.** Ask an agent to add ideas, cluster them, connect a central goal, and create a decision matrix. Show each action appearing live.
4. **1:25-2:05 — Multi-agent trace.** Start recording, let Explorer propose, Critic challenge, and Synthesizer decide. Add one human constraint and point out that all participants are visible.
5. **2:05-2:30 — Reusable artifacts.** Inspect the decision matrix and show Artifact Spec 1.0 fields and primitive records.
6. **2:30-2:50 — Persistence and export.** Finish the trace, show SQLite sync, then export Markdown or CSV.
7. **2:50-2:58 — Close.** “Canvas Relay turns a visual board into a shared, inspectable action surface for people and agents.”

## Submission checklist

- [ ] Deploy a working public URL.
- [ ] Test the deployed URL in ChatGPT's in-app browser or Chrome 149+ with WebMCP enabled.
- [ ] Push this repository to public GitHub, GitLab, or Bitbucket.
- [x] Include all source, assets, setup instructions, and an open-source `LICENSE` file.
- [ ] Add the license in the repository About section so Devpost can detect it.
- [ ] Record a public YouTube video under three minutes, with audio and no unlicensed music or trademarks.
- [ ] Submit the English description, live URL, public repository URL, and YouTube URL on Devpost.
- [ ] Keep the app freely accessible for judges through the end of judging.
