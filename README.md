# Canvas Relay

Canvas Relay is an offline-first visual thinking workspace where people and browser agents shape the same board. It combines an infinite canvas, hosted share links, typed brainstorming elements, visual connections, semantic clusters, reusable structured artifacts, and exportable multi-agent decision traces.

The repository includes a tiny Express + Drizzle + SQLite backend with capability-based access and no account system or third-party services. The browser writes to `localStorage` first and synchronizes hosted murals and recordings to SQLite when the backend is available, so the app remains useful offline and takes one command to run.

## Quick start

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open the localhost URL printed by Vite. The included demo board loads automatically on first use.

- Web app: `http://localhost:5173`
- Local API: `http://localhost:5174`
- SQLite file: `data/canvas-relay.sqlite` (created automatically)

Useful commands:

```bash
npm run test
npm run lint
npm run build
npm run preview
```

## What people can do

- Pan, zoom, select, drag, resize, and connect elements on an infinite canvas.
- Add ideas, questions, insights, actions, frames, decision matrices, concept cards, and checklists.
- Edit element content, colors, votes, clusters, and positions.
- Organize the board as a grid, semantic columns, radial map, or compact stack.
- Undo and redo human or agent mutations.
- Change element layers from the inspector, keyboard, or right-click menu.
- Keep a local library of UUID murals, open them in separate instances, and import or export portable JSON.
- Record a visible multi-agent discussion with participant identity, replies, canvas actions, decisions, and final output.
- Let the agent that creates a WebMCP session moderate it and mute or reactivate participants.
- Give agents distinct colors and renewable edit-focus leases that prevent overlapping work.
- Save editable timeline checkpoints and replay the mural non-destructively with Previous and Next controls.
- Publish a local mural and create or rotate private collaborator links from the Share dialog.
- Export a decision trace as JSON, Markdown, or CSV.
- Reload the page without losing the board.

Keyboard shortcuts:

- `N`: add an idea
- `Q`: add a question
- `Delete` or `Backspace`: remove the selected element
- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z`: redo
- `Cmd/Ctrl + D`: duplicate
- `Cmd/Ctrl + ]` / `[`: move one layer forward or backward
- `Alt + Cmd/Ctrl + ]` / `[`: move to front or back
- `+`, `-`, `0`: zoom in, zoom out, fit board

## WebMCP

Canvas Relay registers tools with the current imperative API:

```ts
document.modelContext.registerTool(tool, { signal })
```

It falls back to `navigator.modelContext` for earlier browser implementations. The app stays fully usable when WebMCP is unavailable and shows setup guidance in the Agent panel.

Test with either:

- ChatGPT desktop's in-app browser.
- Google Chrome 149 or newer with `chrome://flags/#enable-webmcp-testing` enabled.

The twenty-seven registered tools are:

| Tool | Purpose |
| --- | --- |
| `canvas_create_mural` | Create a hosted mural plus separate owner and user links. |
| `canvas_get_board` | Read elements, artifact specs, and connections. |
| `canvas_rename_mural` | Rename the mural shown beside the logo and in exports. |
| `canvas_add_element` | Add one visual element. |
| `canvas_add_elements` | Add up to 30 elements in one action. |
| `canvas_update_element` | Edit content, type, style, votes, cluster, or position. |
| `canvas_connect_elements` | Draw a labeled relationship. |
| `canvas_remove_elements` | Remove elements and attached connections. |
| `canvas_arrange_board` | Apply grid, semantic columns, radial, or stacked layout. |
| `canvas_create_cluster` | Add a labeled container and optionally arrange its members. |
| `canvas_create_artifact` | Create a reusable structured artifact. |
| `canvas_get_artifact_spec` | Read an artifact's fields, records, and presentation. |
| `canvas_update_artifact_records` | Replace or append artifact records. |
| `canvas_focus_elements` | Select and bring elements into view. |
| `canvas_set_focus` | Claim or release a visible, expiring edit/review focus lease. |
| `canvas_add_checkpoint` | Let the moderator capture a replayable mural milestone. |
| `canvas_set_element_layer` | Move an element through the visual z stack. |
| `canvas_start_recording` | Start a trace; the creating agent becomes moderator. |
| `canvas_join_session` | Join a mural by UUID and appear in the participant list. |
| `canvas_invite_agents` | Create a private capability and URL for each named agent guest. |
| `canvas_redeem_agent_invite` | Redeem an invite URL and join the hosted trace. |
| `canvas_record_contribution` | Record an explicit proposal, question, critique, evidence item, decision, summary, or result. |
| `canvas_comment_element` | Add a reviewable agent note to an element and the global conversation. |
| `canvas_moderate_participant` | Let the moderator mute or reactivate another agent. |
| `canvas_watch_mural` | Renew a presence lease and poll global or component-scoped changes until the session closes. |
| `canvas_get_recording` | Read participant identities and the shared event timeline. |
| `canvas_finalize_recording` | Preserve the final output and close the trace. |

All UI and WebMCP operations use the same action layer. Agent work appears immediately on the human canvas and is recorded in the visual activity stream. The mural UUID routes a call but is not a credential: write tools also require the private capability returned when that agent starts or joins a session. Muted agents cannot keep changing the board, and another caller cannot take over a visible participant ID or the moderator role.

Recommended agent sequence:

1. For a new online collaboration, call `canvas_create_mural`; retain its owner capability and give the separate `userUrl` to the person.
2. Create named guest links with `canvas_invite_agents`. Each invited agent opens only its own URL and calls `canvas_redeem_agent_invite`.
3. Include `muralId`, `agentId`, and `agentToken` in protected write and watch calls. Moderation additionally uses the creator's `moderatorToken` capability.
4. Claim the elements about to be edited with `canvas_set_focus`; default to `releaseOnAction: after_write`, or renew a manual lease through `canvas_watch_mural`.
5. Repeat `canvas_watch_mural` at its recommended interval to receive changes and know when the session closes. Use review triggers, a quiet period, and a cooldown so agents do not answer their own events or interrupt one another.
6. Save meaningful milestones with `canvas_add_checkpoint`. Share conclusions with `canvas_record_contribution`; the moderator can use `canvas_moderate_participant` when needed.

## Artifact Spec 1.0

Artifacts are data, not screenshots or opaque HTML. Each artifact uses a small JSON spec that agents can read, create, update, reuse, and export.

Supported artifact types: `table`, `cards`, `checklist`, `matrix`, and `custom`.

Supported primitive field types: `text`, `number`, `status`, `tag`, `boolean`, `date`, and `url`.

Example:

```json
{
  "specVersion": "1.0",
  "artifactType": "matrix",
  "title": "Decision matrix",
  "description": "Compare ideas using shared criteria.",
  "fields": [
    { "key": "option", "label": "Option", "type": "text", "required": true },
    { "key": "impact", "label": "Impact", "type": "status", "options": ["High", "Medium", "Low"] },
    { "key": "effort", "label": "Effort", "type": "status", "options": ["High", "Medium", "Low"] }
  ],
  "records": [
    { "option": "Walking stand-ups", "impact": "High", "effort": "Low" }
  ],
  "presentation": {
    "layout": "table",
    "density": "compact",
    "visibleFields": ["option", "impact", "effort"]
  }
}
```

The complete machine-readable JSON Schema is served at [`/artifact-spec.schema.json`](./public/artifact-spec.schema.json). `canvas_get_artifact_spec` also returns that schema URL with the selected artifact.

Limits keep tool calls understandable and safe: 12 fields, 100 records, primitive record values, validated field keys, and plain text rendered by React.

## Suggested agent demo

Start with a blank board and give a WebMCP-capable agent this prompt:

> Create a brainstorm for reducing food waste in a university cafeteria. Add 12 ideas, organize them into Prevention, Redistribution, and Composting, create a central goal, then build a decision matrix comparing the four strongest ideas.

The agent can:

1. Add ideas in one batch.
2. Read the resulting board and stable element IDs.
3. Organize ideas and create cluster frames.
4. Connect groups to the central goal.
5. Create a structured matrix with fields and primitive records.
6. Read or update the artifact spec in a follow-up turn.

This demonstrates why WebMCP is central to the experience: the agent works with product concepts and structured data while the user sees, adjusts, and controls the same live visual state.

## Decision Trace

Recording is an explicit, shared collaboration log. It captures user messages, agent contributions, reply relationships, board actions, participants, decisions, and the final board. It does not capture hidden model chain-of-thought or private reasoning.

Use **Trace** for a new recording or load the three-agent demo to see a facilitator, Explorer, Critic, and Synthesizer discuss a decision. The stream stores shared messages and explicit action summaries, never hidden chain-of-thought. Finished sessions can be downloaded as JSON, Markdown, or CSV.

Each mural has a UUID and URL such as `/?mural=<uuid>`. The Murals menu can open any board in a separate tab. Tabs on the same mural merge component changes, deletion tombstones, participants, and trace events over `BroadcastChannel`; hosted clients carry the same version stamps and tombstones through SQLite so simultaneous agent additions and edits are merged instead of blindly replacing the board. Tabs on different murals remain pinned to their own channel. Separate browser profiles or isolated contexts isolate storage completely.

## Lightweight local API

The Vite frontend proxies `/api` to the bundled server while developing. A production build can be served by the same Express process with `npm run build && npm start`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check SQLite availability. |
| `GET /api/sessions/:id` | Read a full session and final board; hosted traces require a mural capability. |
| `PUT /api/sessions/:id` | Upsert the current session snapshot; hosted traces require a mural capability. |
| `DELETE /api/sessions/:id` | Delete one saved session with its mural capability. |
| `GET /api/sessions/:id/export?format=json\|markdown\|csv` | Compile an authenticated hosted export on the backend. |
| `POST /api/murals` | Create a hosted mural and owner/user capabilities. |
| `GET/PUT /api/murals/:id` | Load or synchronize a hosted mural with a capability. |
| `POST /api/murals/:id/invites` | Create named agent invitations as the owner. |
| `POST /api/murals/:id/invites/redeem` | Redeem one agent invitation. |

## Production deploy

The hidden deployment helper mirrors Beacon's single-host process: it rsyncs the current tree to `/srv/aimural`, builds an isolated Docker Compose project, and exposes only `127.0.0.1:46731` for CloudPanel's nginx reverse proxy.

```bash
.bin/deploy
```

No credentials are stored in the repository. Override the target with `AIMURAL_DEPLOY_HOST` or `AIMURAL_REMOTE_DIR` when needed.

## Local data and privacy

- Mural keys: `canvas-relay-board-v2:<mural-uuid>`
- Current mural key: `canvas-relay-current-board-v2`
- Recording keys: `canvas-relay-recording-v1:<mural-uuid>`
- Theme key: `canvas-relay-theme`
- SQLite is local to the cloned repository and ignored by Git.
- No analytics, third-party network requests, cookies, passwords, or account database. Hosted access uses unguessable capabilities stored only as SHA-256 hashes server-side; raw trace listing is not exposed publicly.
- Resetting the demo replaces the current board but remains undoable during the session.
- Export before clearing browser storage if you want a portable backup.

## Project structure

```text
src/
  components/       Canvas nodes, tool rail, inspector, agent panel
  lib/api.ts        Optional SQLite synchronization client
  lib/artifacts.ts  Artifact Spec validation and templates
  lib/board.ts      Deterministic canvas primitives and layout
  lib/recording.ts  Decision Trace session model and local exports
  lib/storage.ts    localStorage persistence
  lib/webmcp.ts     WebMCP tool registration and schemas
  App.tsx           Shared action layer, history, and workspace
server/
  db.ts             Self-initializing SQLite database
  schema.ts         Drizzle schema
  store.ts          Session persistence
  hosted.ts         Hosted murals and capability-based agent invitations
  export.ts         Backend JSON, Markdown, and CSV compilation
  index.ts          Express API and production static server
public/
  artifact-spec.schema.json
.codex/skills/
  canvas-relay/     Hidden reusable agent workflow, safe for the public repo
.bin/deploy         One-command rsync + Docker deployment beside Beacon
```

## License

MIT. See [LICENSE](./LICENSE).
