# cistem.io

A system-design sketchpad where components have behaviour, not just shape.

Draw clients → load balancer → services → Redis / Postgres / Kafka, give each component its capacity, set a target RPS, and the tool propagates load through the graph and tells you which component breaks first and roughly what the end-to-end latency looks like.

## Running it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml` (enable Pages → Source: GitHub Actions in the repo settings once).

## How the model works

- Every edge carries **calls per incoming request** (one API call = 2 cache lookups + 1 DB query, say).
- A **cache** only passes its misses downstream (`1 − hit ratio`).
- A **load balancer** splits incoming load evenly across its outgoing edges.
- A **Postgres** node spreads reads across primary + replicas; writes hit the primary only.
- Load is propagated with a fixed-point iteration (so cycles such as retries are tolerated, and flagged if they don't converge).
- Latency inflates as utilisation rises (`base / (1 − util)`, capped at 10×), which is an M/M/1 approximation and nothing more.

This is a back-of-envelope calculator with a UI, not a load test. It won't see GC pauses, lock contention or tail amplification.

## Layout

```
src/model.ts    component kinds, defaults, document shape, example
src/engine.ts   capacity, propagation, latency
src/state.ts    shared app state, persistence, render pub/sub
src/canvas.ts   SVG rendering, pan/zoom/drag/connect
src/sheet.ts    per-component property editors
src/main.ts     toolbar wiring and boot
```
