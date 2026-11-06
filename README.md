# cistem.io

Diagrams whose components have behaviour, not just shape.

The first diagram kind is **system**: draw clients → load balancer → services → Redis / Postgres / Kafka, give each component its capacity, set a target RPS, and cistem propagates load through the graph and tells you which component breaks first and roughly what the end-to-end latency looks like. Services carry their endpoints, databases their tables, Kafka its topics and Avro schemas, so the diagram is also the design doc.

Other kinds (flow, sequence, state, ER) will share the same shell and file envelope.

## Running it

One deployable: Spring Boot serves the API and the built frontend from the same origin, so there is nothing to configure in the browser.

```sh
# frontend with hot reload (proxies /api and /oauth2 to :8080)
npm install && npm run dev            # http://localhost:5173

# backend (needs Postgres on localhost:5432, user/db/password: cistem)
cd backend && COOKIE_SECURE=false ./gradlew bootRun

npm test                               # schema + migration tests
(cd backend && ./gradlew test)         # API tests against Postgres
```

Pushes to `main` run CI and redeploy the Railway service, which builds `backend/Dockerfile` from the repo root (frontend, then the jar).

## Accounts and storage

Sign in with GitHub (Spring Security OAuth2 client). Sessions are cookies stored in Postgres (Spring Session JDBC), so a redeploy doesn't sign anyone out. Spring never sees a password; GitHub supplies `id`, `login`, `name` and `avatar_url`, which are upserted into `users` on each login. Diagrams belong to a user and are stored as `jsonb` in the cistem.io file format. Signed out, the editor still works and keeps the diagram in the browser; the first save after signing in creates it in the account.

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
| `POST /api/diagrams` | `{ "document": <file> }` → 201 + `ETag: "<version>"` |
| `GET /api/diagrams/{id}` | full diagram |
| `PUT /api/diagrams/{id}` | replace; send `If-Match`; 409 with current body on conflict |
| `DELETE /api/diagrams/{id}` | |
| `POST / DELETE /api/diagrams/{id}/share` | create or revoke a share token |
| `GET /api/share/{token}` | public, read-only |

Cookie sessions carry CSRF protection (`XSRF-TOKEN` cookie → `X-XSRF-TOKEN` header); API-key calls don't need it.

## MCP server

cistem is also an MCP server, so Claude (claude.ai, Claude Code) can read and change your diagrams and run the capacity model in conversation.

- Endpoint: `https://<host>/mcp` (Streamable HTTP)
- Auth: OAuth 2.1 with cistem as the authorization server. Add the URL as a custom connector; the client registers itself (dynamic client registration), you're sent through the normal GitHub sign-in, and the token it receives is bound to your account. No keys to paste.
- Tools: `list_diagrams`, `get_diagram`, `evaluate`, `create_diagram`, `delete_diagram`, `rename_diagram`, `set_target_rps`, `add_component`, `set_properties`, `remove_component`, `connect`, `set_edge`, `disconnect`, `auto_organise`. Every edit returns a fresh evaluation.
- Resource: `cistem://schema` (the JSON Schema below).
- The Java engine (`backend/src/main/java/io/cistem/engine`) is a port of the TypeScript one; `ParityTest` pins both to identical numbers on a fixture generated from the TS side.
- The editor polls for versions saved elsewhere, so MCP edits appear on an open canvas within a few seconds.

Scripts can still use `X-Api-Key` on `/mcp` (acting as the configured account); on `/mcp`, `Authorization: Bearer` always means an OAuth access token.

## File format

Diagrams are plain JSON, described by [`schema/cistem.schema.json`](schema/cistem.schema.json):

```jsonc
{
  "version": 2,
  "kind": "system",
  "meta":   { "title": "...", "created": "...", "updated": "..." },
  "model":  { "targetRps": 5000, "nodes": [...], "edges": [...] },   // what the system is
  "layout": { "positions": { "<node id>": { "x": 0, "y": 0 } } }   // where it is drawn
}
```

`model` never contains coordinates or computed results; `layout` can be empty and the editor will auto-organise. Older files are migrated on load (`src/document.ts`); a file from a newer version is refused with a clear message rather than silently mangled.

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
