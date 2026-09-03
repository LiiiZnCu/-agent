---
name: canvas-relay
description: Collaborate on a Canvas Relay mural through its WebMCP tools, including structured artifacts, review comments, multi-agent traces, and event-driven watching.
---

# Canvas Relay

Use Canvas Relay's registered WebMCP tools instead of simulating pointer gestures. Keep every contribution attributable and visible in the shared stream.

## Join and work

1. When asked to create an online collaboration, call `canvas_create_mural`. Keep its owner token private, give `userUrl` to the person, and create one named guest URL per collaborating agent with `canvas_invite_agents`.
2. An invited agent opens only its assigned URL and calls `canvas_redeem_agent_invite`. For an existing non-invited session, read the mural UUID and use `canvas_join_session` with a stable, unique agent ID and useful specialty.
3. Keep the returned `agentToken` private. Send `muralId`, `agentId`, and `agentToken` with protected write and watch calls. Never treat the public mural UUID as authorization.
4. Prefer semantic operations such as add, update, connect, cluster, arrange, layer, comment, and artifact tools. Read an artifact spec before changing its records.
5. Before changing existing elements, call `canvas_set_focus` with a short visible intent. Prefer `releaseOnAction: after_write`; use `manual` only for multi-step work and renew it through `canvas_watch_mural`.
6. Put proposals, critiques, evidence, questions, decisions, and concise reasoning summaries in `canvas_record_contribution`. Do not publish hidden chain-of-thought, credentials, or private context.

## Review without loops

Use `canvas_watch_mural` as a renewable lease. Keep the returned cursor and follow `nextPollInSeconds` while `shouldContinue` is true. Respond only when `shouldRespond` is true.

Choose the narrowest useful triggers: direct mentions, replies to this agent, comments on elements it authored, watched-element changes, or open decision questions. Keep `ignoreOwnEvents` enabled, use a quiet period so collaborators can finish, and use a cooldown before contributing again. An expired lease means the agent is offline; a completed session means stop polling.

When holding a manual focus lease, pass `renewFocus: true` only while the work is still active. Release focus explicitly when abandoning the task.

## Moderation and completion

The agent that creates a trace receives the moderator capability. Use it only to mute a participant that is disrupting the mural or to reactivate one intentionally. Capture meaningful milestones with `canvas_add_checkpoint` so the user can replay the visual process. Finalize only when the shared stream contains an explicit decision or the user directly requests closure. Exports contain visible contributions and checkpoint snapshots, never private model reasoning.
