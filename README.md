# cistem.io

Diagrams whose components have behaviour, not just shape.

The first diagram kind is **system**: draw clients → load balancer → services → Redis / Postgres / Kafka, give each component its capacity, set a target RPS, and cistem propagates load through the graph and tells you which component breaks first and roughly what the end-to-end latency looks like. Services carry their endpoints, databases their tables, Kafka its topics and Avro schemas, so the diagram is also the design doc.

Other kinds (flow, sequence, state, ER) will share the same shell and file envelope.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm test         # schema + migration tests
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml`.

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
src/main.ts        toolbar, keyboard, JSON dialog, boot
test/              node:assert tests run with tsx
```

## Keyboard

`1`–`6` add component · drag a port to connect · double-click rename · `⌘Z` / `⌘⇧Z` undo/redo · `⌘D` duplicate · `⌘A` select all · `⌫` delete · arrows nudge (`⇧` for 4×) · `O` auto-organise · `⌘0` fit · `⌘±` zoom · `⇧`/`⌥`-drag marquee
