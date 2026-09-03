# Canvas Relay

Canvas Relay is a local-first visual thinking workspace where people and browser agents shape the same board. It combines an infinite canvas, typed brainstorming elements, visual connections, semantic clusters, reusable structured artifacts, and exportable multi-agent decision traces.

The repository includes a tiny Express + Drizzle + SQLite backend, with no accounts, API keys, containers, or external services. The browser writes to `localStorage` first and synchronizes recordings to the local SQLite file when the backend is available, so the app remains useful offline and takes one command to run.

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
- Organize the board as a grid, semantic columns, or a radial map.
- Undo and redo human or agent mutations.
- Export the complete board as portable JSON.
- Record a visible multi-agent discussion with participant identity, replies, canvas actions, decisions, and final output.
- Export a decision trace as JSON, Markdown, or CSV.
- Reload the page without losing the board.

Keyboard shortcuts:

- `N`: add an idea
- `Q`: add a question
- `Delete` or `Backspace`: remove the selected element
- `Cmd/Ctrl + Z`: undo
- `Cmd/Ctrl + Shift + Z`: redo
- `Cmd/Ctrl + D`: duplicate
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

The seventeen registered tools are:

| Tool | Purpose |
| --- | --- |
| `canvas_get_board` | Read elements, artifact specs, and connections. |
| `canvas_add_element` | Add one visual element. |
| `canvas_add_elements` | Add up to 30 elements in one action. |
| `canvas_update_element` | Edit content, type, style, votes, cluster, or position. |
| `canvas_connect_elements` | Draw a labeled relationship. |
| `canvas_remove_elements` | Remove elements and attached connections. |
| `canvas_arrange_board` | Apply grid, semantic columns, or radial layout. |
| `canvas_create_cluster` | Add a labeled frame around related elements. |
| `canvas_create_artifact` | Create a reusable structured artifact. |
| `canvas_get_artifact_spec` | Read an artifact's fields, records, and presentation. |
| `canvas_update_artifact_records` | Replace or append artifact records. |
| `canvas_focus_elements` | Select and bring elements into view. |
| `canvas_start_recording` | Start a shared decision trace and identify its human facilitator. |
| `canvas_join_session` | Add an agent to the visible participant list. |
| `canvas_record_contribution` | Record an explicit proposal, question, critique, evidence item, decision, summary, or result. |
| `canvas_get_recording` | Read participant identities and the shared event timeline. |
| `canvas_finalize_recording` | Preserve the final output and close the trace. |

All UI and WebMCP operations use the same action layer. Agent work appears immediately on the human canvas and is recorded in the activity panel.

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

Use **Record session** for a new trace or **Load 3-agent demo** to see a facilitator, Explorer, Critic, and Synthesizer discuss a decision. Connected agents can join and contribute through the WebMCP recording tools. Finished sessions can be downloaded as JSON, Markdown, or CSV.

## Lightweight local API

The Vite frontend proxies `/api` to the bundled server while developing. A production build can be served by the same Express process with `npm run build && npm start`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Check SQLite availability. |
| `GET /api/sessions` | List saved traces. |
| `GET /api/sessions/:id` | Read a full session and final board. |
| `PUT /api/sessions/:id` | Upsert the current session snapshot. |
| `DELETE /api/sessions/:id` | Delete one saved session. |
| `GET /api/sessions/:id/export?format=json\|markdown\|csv` | Compile an export on the backend. |

## Local data and privacy

- Storage key: `canvas-relay-board-v1`
- Recording key: `canvas-relay-recording-v1`
- Theme key: `canvas-relay-theme`
- SQLite is local to the cloned repository and ignored by Git.
- No analytics, third-party network requests, cookies, or authentication.
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
  export.ts         Backend JSON, Markdown, and CSV compilation
  index.ts          Express API and production static server
public/
  artifact-spec.schema.json
```

## License

MIT. See [LICENSE](./LICENSE).
