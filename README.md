# cistem.dev

Diagrams whose components have behaviour, not just shape. Live at **https://cistem.dev** (MCP server: `https://cistem.dev/mcp`).

The first diagram kind is **system**: draw clients → load balancer → services → Redis / Postgres / Kafka, give each component its capacity, set a target RPS, and cistem propagates load through the graph and tells you which component breaks first and roughly what the end-to-end latency looks like. Services carry their endpoints, databases their tables, Kafka its topics and Avro schemas, so the diagram is also the design doc.

There are also **sequence** and **class** diagrams; a sequence can draw on a system diagram for its timings.

## Running it

One deployable: Spring Boot serves the API and the built frontend from the same origin, so there is nothing to configure in the browser.

```sh
# frontend with hot reload (proxies /api and /oauth2 to :8080)
bun install && bun run dev            # http://localhost:5173

# backend (needs Postgres on localhost:5432, user/db/password: cistem)
cd backend && COOKIE_SECURE=false ./gradlew bootRun

bun run test                           # schema, format and importer tests
bun run build && bun run preview &     # the built app on :4173
bun run test:e2e                       # browser tests against :4173
(cd backend && ./gradlew test)         # API tests against Postgres
```

## Code layout

```
src/
  domain/     the model, capacity engine, parsers and file format: plain TypeScript, no UI
  store/      app state (Zustand + Immer): the open document, undo as patches, projects and tabs, browser storage (IndexedDB), cloud sync, clipboard
  ui/         the shell (React): header, tabs, details panel, menus, dialogs, the canvas surface
  diagrams/   one folder per kind (system, sequence, class) implementing DiagramModule (diagrams/types.ts)
  editor/     CodeMirror languages and the <CodeEditor> wrapper (loaded on first use)
  lib/        formatting, browser helpers, API client, tooltips
backend/src/main/java/io/cistem/
  auth/       GitHub sign-in, sessions, API key, the current user
  diagram/    the diagrams API, DiagramService (rules shared with MCP), repository, file rules
  mcp/        MCP tools by kind, and the OAuth setup for MCP clients
  engine/     capacity model, layout, sequence text format (parity-tested against the TypeScript)
  web/        serving the frontend, CORS, settings
```

A new kind of diagram is a new folder in `src/diagrams/` that implements `DiagramModule`, plus an entry in `src/diagrams/index.ts`.

Pushes to `main` run CI and redeploy the Railway service, which builds `backend/Dockerfile` from the repo root (frontend, then the jar).

## Accounts and storage

Sign in with GitHub (Spring Security OAuth2 client). Sessions are cookies stored in Postgres (Spring Session JDBC), so a redeploy doesn't sign anyone out. Spring never sees a password; GitHub supplies `id`, `login`, `name` and `avatar_url`, which are upserted into `users` on each login. Diagrams belong to a user and are stored as `jsonb` in the cistem.dev file format, each in exactly one **project** (every account has at least one; "My diagrams" is created when needed). Signed out, the editor still works: projects and diagrams are kept in the browser (IndexedDB), and after signing in they can be added to the account. A whole project exports as one file (`{ "format": "cistem-project", "version": 1, "title", "diagrams": [{ "id", "file" }] }`) and imports as a new project.

Environment variables on the service:

| Variable | |
|---|---|
| `DATABASE_URL`, `PGUSER`, `PGPASSWORD` | JDBC URL + credentials |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth app; callback is `<public url>/login/oauth2/code/github` |
| `CISTEM_PUBLIC_URL` | where to send the browser after login |
| `CISTEM_API_KEY` (optional) | a shared key for scripts/MCP; acts as `CISTEM_API_KEY_LOGIN` or the first account |
| `CISTEM_ALLOWED_ORIGINS` (optional) | CORS, only needed for a separately hosted frontend |

| Endpoint | |
|---|---|
| `GET /api/me` | profile, or 401 |
| `GET /oauth2/authorization/github` → `POST /api/logout` | sign in / out |
| `GET /api/diagrams` | your diagrams (no bodies) |
| `POST /api/diagrams` | `{ "document": <file>, "projectId"? }` → 201 + `ETag: "<version>"` (default project when none) |
| `GET /api/diagrams/{id}` | full diagram |
| `PUT /api/diagrams/{id}` | replace; send `If-Match`; 409 with current body on conflict |
| `DELETE /api/diagrams/{id}` | |
| `POST / DELETE /api/diagrams/{id}/share` | create or revoke a share token |
| `GET /api/share/{token}` | public, read-only |
| `GET / POST /api/projects` | your projects, each with its diagrams (never empty) / create `{ "title" }` |
| `PATCH / DELETE /api/projects/{id}` | rename / delete the project **and its diagrams** |
| `POST / DELETE /api/projects/{id}/share` | create or revoke a project share token |
| `GET /api/share/project/{token}` | public, read-only: the project's title and diagrams |
| `PUT /api/diagrams/{id}/project` | `{ "projectId" }` move a diagram (its version doesn't change) |

Cookie sessions carry CSRF protection (`XSRF-TOKEN` cookie → `X-XSRF-TOKEN` header); API-key calls don't need it.

## MCP server

cistem is also an MCP server, so Claude (claude.ai, Claude Code) can read and change your diagrams and run the capacity model in conversation.

- Endpoint: `https://<host>/mcp` (Streamable HTTP)
- Auth: OAuth 2.1 with cistem as the authorization server. Add the URL as a custom connector; the client registers itself (dynamic client registration), you're sent through the normal GitHub sign-in, and the token it receives is bound to your account. No keys to paste.
- Tools: `list_diagrams`, `get_diagram`, `evaluate`, `create_diagram`, `delete_diagram`, `rename_diagram`, `set_target_rps`, `add_component`, `set_properties`, `remove_component`, `connect`, `set_edge`, `disconnect`, `auto_organise`, and for environments `list_containers`, `add_container`, `set_container`, `move_component`, `remove_container`, `link_containers`, `unlink_containers`. Every edit returns a fresh evaluation.
- Resource: `cistem://schema` (the JSON Schema below).
- The Java engine (`backend/src/main/java/io/cistem/engine`) is a port of the TypeScript one; `ParityTest` pins both to identical numbers on a fixture generated from the TS side.
- The editor polls for versions saved elsewhere, so MCP edits appear on an open canvas within a few seconds.

Scripts can still use `X-Api-Key` on `/mcp` (acting as the configured account); on `/mcp`, `Authorization: Bearer` always means an OAuth access token.

## File format

Diagrams are plain JSON, described by [`schema/cistem.schema.json`](schema/cistem.schema.json):

```jsonc
{
  "version": 3,
  "kind": "system",
  "meta":   { "title": "...", "created": "...", "updated": "..." },
  "model":  { "targetRps": 5000, "nodes": [...], "edges": [...], "containers": [...], "links": [...] },   // what the system is
  "layout": { "positions": { "<node id>": { "x": 0, "y": 0 } }, "frames": { "<container id>": { "x": 0, "y": 0, "w": 0, "h": 0 } } }   // where it is drawn
}
```

`model` never contains coordinates or computed results; `layout` can be empty and the editor will auto-organise. Older files are migrated on load (`src/document.ts`); a file from a newer version is refused with a clear message rather than silently mangled.

## Environments (containers)

Components live in containers: a cloud, an account, a VPC, a region, a data centre or a team, nested as needed (`AWS › acq-core`). Frames on the canvas fit their members automatically; drag a component into a frame to move it there, drag a frame to move everything inside it. Calls that cross a boundary pick up latency: 0 ms inside one container, 1 ms between siblings, 10 ms between different clouds, or whatever a declared link says (`privatelink` 2 ms, `direct-connect` 10 ms, `vpn` 20 ms…). Crossing edges are dashed and show the added latency; `evaluate` lists them.

## Expanded view

Databases, services and Kafka nodes have a chevron (or `Space` with the node selected; `⇧Space` toggles all). Expanded, a Postgres node draws each table with its columns, types and `PK` / `FK` / `UQ` / `IX` tags, and foreign keys are drawn as dashed lines between rows (across databases too). A service lists its endpoints; a Kafka node lists topics with their Avro fields. Auto-organise uses the expanded sizes. Column `references` take `table.column` or `<node id>:table.column`.

## Service types, logos and styles

A **Service** has a type — Microservice, Application, Monolith, Function, Worker or Batch job — shown on its card; every type has endpoints and the same capacity fields. A third party (Stripe, a card scheme, a partner API) is just a service too: give it their rate limit as its capacity.

Any component can have a **dashed border** (panel → Border), e.g. to mark what you don't run, and a **logo**: paste an image (`⌘V`) with components selected, drop an image file onto one, or pick one in the panel. Pasting or dropping an image on empty canvas makes a new Application named after the file. Logos are shrunk to 64 px and stored in the diagram (no uploads), so they work signed out and travel with exports.

## Endpoints

A collapsed service says how many endpoints it has, by method (`3 endpoints · POST 1 · GET 2`); expanded, every endpoint is listed and long paths wrap at a `/`. Drag the handle on a selected card's right edge to make it wider (double-click the handle to reset); the width is saved with the diagram. Hover an endpoint row for its full path; click it to open the Endpoints tab.

A connection can call **several** of its target's endpoints: tick them in the connection's panel. With the load view on, each gets its own calls per request (an upload and four status polls, say); the connection's calls are their sum, the line lists them (or says how many), and the expanded target highlights them and shows the rps each endpoint receives from all its callers. Files with the older single `endpoint` migrate on open.

## Kafka partitions

A topic's capacity is its partitions × **msg/s per partition**, so adding partitions scales it. A service that only consumes topics uses at most one instance per partition it reads (summed over its topics), as a consumer group does: extra instances sit idle, and its panel says so. Anything with direct traffic too spreads that over every instance, so it isn't capped. Topics saved with a single max msg/s keep their capacity, split over their partitions.

Consumers pull. A service fed only by topics or queues never takes more than its capacity: what it can't keep up with waits in the topic as **lag**, so it shows amber ("falls behind", with `lag ↑` on its card), not red. Its panel gives how fast the backlog grows and, from the topic's **retention**, when unread messages would start expiring if the rate lasts. It passes on only what it gets through, and its time counts after the publish, not towards the request: the header shows the request's end-to-end latency, with the async path in its tooltip.

## Sequence diagrams

Long message labels wrap (press Enter in a label to break it yourself; the code writes `\n`), and lifelines are spaced by the wrapped text, so one long label doesn't push the rest off-screen. Lifeline heads size to their name, taking two lines at a hyphen when it's long; drag a selected head's right edge to widen it (double-click the handle or **Fit the name** to reset). Hover a head for its ◀ ⠿ ▶ grip to reorder; the panel also has Move left/right and up/down.

Lifelines take a colour, a dashed border and a logo; messages a colour and bold; blocks a colour. Style isn't written in the code, and survives editing it.

Two kinds of note: **Note over** (the sequence tool, `N`) is part of the flow and the code — over one or more lifelines, or `note left of` / `note right of` one. Drag it up or down to move it in the flow, sideways onto other lifelines, and drag its edges to span more or fewer. **Sticky** (the yellow rail button) is free on the canvas. Convert either way: **Make it a sticky** in a note's panel, **Pin to lifelines** on a selected sticky. Fit to view (`⌘0`) includes stickies on every kind of diagram.

## Copy as image

The image button in the top bar (or `⌘⇧C`) copies the whole diagram, not just what's on screen, as a PNG at 2×: paste it straight into Confluence, a doc or a slide. Export / import also has **Download PNG** and **Download SVG**. The picture leaves out the grid, selection and app chrome, always uses the light theme, includes canvas notes, and embeds the app's fonts (IBM Plex, OFL, served from `/fonts`).

## Load view

The load model (rps on cards and connections, capacity bars, the verdict and the header total) is hidden by default, since most diagrams are architecture. Turn it on with the gauge button or `L`; the choice is remembered in your browser. With it off, the capacity fields sit in a collapsed *Load model* section of the panel and connection labels show the endpoint called.

## How the capacity model works

- Every edge carries **calls per incoming request** (one API call = 2 cache lookups + 1 DB query, say).
- A **cache** only passes its misses downstream (`1 − hit ratio`).
- A **load balancer** splits incoming load evenly across its outgoing edges.
- A **Postgres** node spreads reads across primary + replicas; writes hit the primary only.
- Load is propagated with a fixed-point iteration (so cycles such as retries are tolerated, and flagged if they don't converge).
- Latency inflates as utilisation rises (`base / (1 − util)`, capped at 10×), which is an M/M/1 approximation and nothing more.

This is a back-of-envelope calculator with a UI, not a load test. It won't see GC pauses, lock contention or tail amplification.

## Layout

```
schema/cistem.schema.json   JSON Schema for diagram files
src/model.ts       component kinds, defaults, editor document, example
src/document.ts    file envelope, versioning and migrations
src/engine.ts      capacity, propagation, latency
src/history.ts     undo/redo
src/state.ts       shared app state, persistence, render pub/sub
src/canvas.ts      SVG rendering, pan/zoom/drag/connect/marquee
src/layout.ts      auto-organise (layered)
src/sheet.ts       inspector (capacity + schema editors)
src/api.ts         API client
src/cloud.ts       sign-in state, diagram drawer, autosave, conflicts, share, live refresh
src/main.ts        toolbar, keyboard, JSON dialog, boot
backend/           Spring Boot API, MCP server, OAuth authorization server (see above)
test/              node:assert tests run with tsx
```

## Keyboard

`1`–`6` add component · drag a port to connect · double-click rename · `⌘Z` / `⌘⇧Z` undo/redo · `⌘D` duplicate · `⌘A` select all · `⌫` delete · arrows nudge (`⇧` for 4×) · `O` auto-organise · `⌘0` fit · `⌘±` zoom · `⇧`/`⌥`-drag marquee
