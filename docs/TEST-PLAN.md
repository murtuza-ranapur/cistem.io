# cistem.io — test plan

What the product promises, feature by feature: the **invariants** that must always hold, the **limits** it
must survive, the **inputs** it accepts and the **outputs** it produces. Each line is something a test can
check. Automated coverage is noted as `[unit]` (test/*.test.ts), `[e2e]` (test/e2e.js), `[java]`
(backend tests) or `[manual]`.

Personas used for exploratory testing are at the end.

---

## 1. Documents and storage

### 1.1 File format (system, sequence, class)
- **Inputs:** any JSON a user pastes or imports; files of every version the app has written (v1–v4); documents written by MCP.
- **Outputs:** a `{version, kind, meta, model, layout}` file that validates against `schema/cistem.schema.json`.
- **Invariants**
  - Every file the app writes validates against the schema. `[unit]`
  - Loading then saving a file preserves its content (round trip), apart from `meta.updated`. `[unit]`
  - Older versions migrate to v4 identically in the browser and the server (`Migrate.java`). `[unit][java]`
  - Unknown future versions are refused with a clear message, never half-loaded. `[unit]`
  - `kind` decides the model: system → nodes/edges/containers/links; sequence → participants/rows; class → classes/relations.
- **Limits:** a malformed file (wrong types, missing arrays, `null`s, extra fields, 5 MB of JSON, deeply nested JSON) must be rejected with a message, never crash the page or replace the current diagram.

### 1.2 Local persistence and tabs
- **Inputs:** edits; reloads; closing/opening/reordering tabs; private windows (no storage).
- **Invariants**
  - Every tab's document survives a reload, in its own storage slot. `[e2e]`
  - The tab list, order and active tab survive a reload. `[e2e]`
  - Each tab keeps its own undo history and view while the page is open. `[e2e]`
  - Closing a tab deletes its local slot; closing a local-only tab asks once. `[e2e]`
  - Closing the last tab leaves one blank tab — never zero tabs. `[e2e]`
  - A pre-tabs local document becomes the first tab (migration).
  - Storage being unavailable or full never breaks editing (writes are best-effort).
- **Limits:** 30+ tabs; very long titles; two browser windows editing the same storage.

### 1.3 Cloud (signed in)
- **Inputs:** GitHub sign-in; edits; MCP edits made elsewhere; another device; deleting from the drawer; share links.
- **Invariants**
  - Only real changes save: selecting, panning or opening the panel never creates a version. `[manual — verified]`
  - A change saves within ~1 s; status reads saving → saved; ⌘S saves now.
  - Edits made through MCP appear in the open tab within ~4 s when it has no unsaved edits.
  - A version conflict never silently loses work: the user chooses.
  - Deleting a diagram closes its tab; opening one already open switches to its tab.
  - A share link opens read-only; editing is impossible; it opens in its own tab.
  - Sessions last 30 days and survive server restarts. `[java]`
- **Limits:** offline (requests fail) → status says so and retries; 401 mid-session → sign-in prompt, local work kept.

### 1.4 Undo / redo
- **Invariants**
  - Every user-visible change is undoable as one step (drag = one step, typing in a field = one step per focus).
  - Undo after opening the example/import restores the previous diagram and title. `[e2e]`
  - Redo is cleared by a new change.
  - Undo never crosses tabs.
- **Limits:** 100+ steps; undo during a drag; undo while a text editor has focus (the editor's own undo wins).

### 1.5 Copy, cut, paste
- **Inputs:** ⌘/Ctrl+C, X, V, D; the right-click menu (Cut, Copy, Paste, Duplicate, Delete) on all three canvases; text pasted from other apps.
- **Outputs:** the system clipboard gets readable text (system: JSON marked `"cistem-clipboard": 1`; sequence: the text format; class: the text format headed `%% cistem copy {positions}`). A copy is also kept in `cistem.clip`, so the menu's Paste works without clipboard permission.
- **Invariants**
  - System: selected components, the connections between them, and selected environments with everything inside are copied. Pasted items get new ids and become the selection. `[e2e]`
  - Paste lands at the pointer when it's over the canvas, otherwise 32px further down-right with each repeat paste. Beside the original it stays in the same environment. `[e2e]`
  - Sequence: messages, notes and whole blocks paste below the selection (after a block's end) or at the end. Missing lifelines are added. A lifeline copied alone pastes as a new lifeline. Text, Mermaid and PlantUML from other apps paste too. `[e2e]`
  - Class: classes and the relations between them are copied. Taken names become `NameCopy`, `NameCopy2`. Java, Kotlin and Mermaid paste merge as before. `[e2e]`
  - Each paste or cut is one undo step. Works across tabs of the same kind. Typing in a field or code editor keeps the normal text clipboard. `[e2e]`
- **Limits:** pasting a hand-edited or hostile clipboard (it goes through the same file sanitiser); pasting system JSON into a sequence tab (ignored).

---

## 2. System diagrams

### 2.1 Component types (data-driven, `shared/component-types.json`)
- **Inputs:** a type's label, icon, colour, width, group, behaviour, detail kind, defaults and fields.
- **Invariants**
  - Every type's defaults validate against the schema. `[unit]`
  - The engine only reads behaviours: adding a type needs no engine change; the browser and server agree on every type. `[unit][java]`
  - The toolbar is grouped by `group`, in order; 1–9 add the first nine types.
- **Limits:** a type with no fields; a type with an unknown behaviour (treated as no capacity).

### 2.2 Adding, selecting, moving, deleting components
- **Inputs:** toolbar click, drag from toolbar, keys 1–9, double-click? (no), duplicate ⌘D, Delete/Backspace, arrows (8 px, Shift 32 px), shift-click, marquee, ⌘A, Escape.
- **Invariants**
  - A new component never lands on top of another (free spot near the view centre). `[e2e]`
  - A new component dropped inside an environment belongs to it.
  - Deleting a component deletes its edges and nothing else.
  - Moving snaps to the grid; positions are integers.
  - Selection is cleared when the selected thing is deleted or undone away.
- **Limits:** 300 components; components far outside the view; names of 0 or 500 characters, emoji, RTL text, HTML (`<img onerror>`) — always shown as text, never executed.

### 2.3 Connections (edges)
- **Inputs:** drag from a component's port to another; calls per request; endpoint choice; Delete.
- **Invariants**
  - No duplicate edge between the same two components in the same direction.
  - No edge from a component to itself unless intended (refused or clearly drawn).
  - Edges re-route when either end moves; they follow environment moves.
- **Limits:** cycles (A→B→A); 50 edges into one component; `calls` of 0, negative, 1e9, text.

### 2.4 Capacity engine
- **Inputs:** each client's peak rps; per-type numbers (instances, rps per instance, max rps/ops/qps, replicas, read share, hit ratio, latency, max throughput); edge `calls`; environment link latency.
- **Outputs:** per component load, capacity, utilisation, status, effective latency; per edge rps; verdict (worst status + node), end-to-end latency, total rps.
- **Invariants** `[unit][java parity]`
  - Status: util ≥ 1 → crit; ≥ 0.7 → warn; else ok. The verdict is the worst status.
  - Load balancers split evenly; caches pass `1 − hitRatio` downstream; everything else passes all of its load to each edge × `calls`.
  - Stores: capacity = maxQps ÷ max(writes + reads/(1+replicas), reads/(1+replicas)).
  - Consumers of a queue never republish into the queue they consumed from (no runaway loops).
  - Latency: base ÷ (1 − util), capped at 10× base; crossings between environments add the link latency.
  - Browser and server produce identical results for the same document.
  - Total load = sum of clients' rps; "Load" chip what-if scales clients proportionally.
- **Limits:** cycles must converge or report non-convergence; zero capacity; NaN/Infinity/negative inputs are treated as 0, never shown as NaN; 0 clients → "no load".

### 2.5 Environments (containers) and links
- **Inputs:** add (E), kind, provider, owner, nesting, drag components in/out, frame drag/resize, colour/fill/border, links with type and latency.
- **Invariants**
  - Dragging a frame moves everything inside it, including nested frames. `[e2e]`
  - A component belongs to the innermost frame it's dropped in; dragging out removes membership.
  - Deleting an environment keeps its components (they move to the parent) unless chosen otherwise.
- **Limits:** 6 levels of nesting; an empty environment; a frame dragged onto itself.

### 2.6 Detail editors (endpoints, tables, topic, message)
- **Inputs:** method/path/headers, request/response JSON; table rows / DBML code; Avro schemas; partitions/key/cluster.
- **Invariants**
  - Code and rows views are the same data; an invalid draft never overwrites the last valid model. `[e2e]`
  - JSON/Avro/DBML editors highlight, suggest and underline problems at the offending token. `[unit][e2e]`
  - Expanding a component pushes neighbours instead of overlapping; collapsing gives the room back. `[e2e]`
- **Limits:** 200 columns; 50 tables; a 2,000-line schema; pasting SQL `CREATE TABLE`.

### 2.7 Layout, view, panel, keyboard
- **Invariants**
  - Organise (O) never overlaps components and keeps environments enclosing their components.
  - Fit (⌘0) shows everything; zoom stays within limits; the grid moves with the view. `[e2e]`
  - Panel: auto opens on selection, pinned stays, hidden stays hidden; drag release never opens it. `[e2e]`
  - Keyboard shortcuts never fire while typing in a field or code editor. `[e2e]`
  - Tooltips appear quickly and never cover the thing being pointed at.

---

## 3. Sequence diagrams
- **Inputs:** participants (P / toolbar), drag lifeline→lifeline (call/async/reply by tool), self-calls, notes, blocks (alt/opt/loop/par, else/and), text (this format, Mermaid, PlantUML), linking to a system diagram.
- **Outputs:** auto-laid-out drawing with activation bars; per-call running time and end-to-end time from the linked capacity model; text.
- **Invariants**
  - Text ↔ model round trip is stable (`print(parse(print(x))) = print(x)`); browser and server parse/print identically. `[unit][java]`
  - Blocks are always balanced; moves that would break a block are refused. `[unit][e2e]`
  - A message is inserted where it's dropped; moving keeps relative order of everything else. `[e2e]`
  - Deleting a participant deletes its messages and removes it from notes.
  - Deleting a block keeps its messages.
  - Activation: a call opens one on the callee; the matching reply closes it.
  - Invalid text never replaces the drawing; problems carry line numbers. `[unit][e2e]`
- **Limits:** 40 participants; 500 rows; 10-deep nesting; labels of 300 characters; participant ids colliding after rename; a self-call inside a loop; pasting garbage.

## 4. Class diagrams
- **Inputs:** classes (toolbar 1–5, double-click canvas), members (one-line add, inline edit), relations (drag dot → picker), text (this format, Mermaid), Java/Kotlin paste, generate from tables/Avro.
- **Outputs:** boxes with members, relations with UML markers and multiplicities, text.
- **Invariants**
  - Class names are unique; renaming updates relations, positions and member types. `[unit][e2e]`
  - Every class has a position after load or paste; pasted classes never overlap existing ones. `[unit][e2e]`
  - Relations only connect existing classes; deleting a class deletes its relations.
  - Text round trip is stable. `[unit]`
  - Java/Kotlin import never throws; unknown constructs are skipped. `[unit]`
- **Limits:** 100 classes; a class with 80 members; generics `Map<String, List<Optional<X>>>`; inner classes; annotations with arguments; Lombok; comments containing braces.

---

## 5. Server and MCP
- **Inputs:** REST (diagrams CRUD, share, me), MCP over OAuth (DCR, PKCE, refresh), API key.
- **Invariants** `[java]`
  - A user only ever sees and changes their own diagrams; share tokens are read-only.
  - Access tokens carry the `/mcp` audience, also after refresh; public clients get 30-day tokens; confidential ones refresh.
  - Version checks: an update with a stale version is refused (409), never merged silently.
  - System tools refuse sequence/class diagrams with a message naming the right tools.
  - Every MCP edit returns a fresh evaluation (system) or the stored text (sequence).
- **Limits:** 1 MB documents; 200 diagrams; concurrent edits from MCP and the browser; malformed tool arguments.

---

## 6. Cross-cutting
- **Security:** user text is always escaped (names, labels, notes, member names, titles, tab titles, drawer list, tooltips, share pages).
- **Accessibility:** every button has a name; focus is visible; menus work with the keyboard; colour is never the only signal.
- **Themes:** light and dark render every surface legibly.
- **Phones:** toolbar is one scrolling strip; panels and menus fit the screen; touch can pan, select and drag.

---

## Personas

**Priya — first time.** Product manager; has never drawn a system diagram. Clicks whatever looks clickable,
double-clicks things, uses a phone half the time, types names with spaces and emoji, expects Undo to fix
anything, leaves fields empty, doesn't read hints.

**Sam — regular.** Backend engineer who draws a diagram every couple of weeks. Builds a realistic service
graph with a database and a queue, imports and exports JSON, uses the main shortcuts, works across several
tabs, makes a sequence from a request path and a class diagram from tables, signs in and expects saves to
stick.

**Dana — veteran from draw.io and Lucidchart.** Architect who lives in diagram tools. Expects ⌘C/⌘V of
shapes, multi-select and group moves, marquee selection, Shift-constrained drags, right-click menus,
Ctrl-scroll zoom, keyboard everything, exporting images, huge diagrams, pasting arbitrary text, and is
deliberately trying to break it: rapid undo/redo, edits during drags, odd input, many tabs, two windows.

---

## Exploratory testing — 7 Nov 2026

Three testers, one per persona, drove the production build in a real browser (desktop, Pixel 7, iPhone 13,
light and dark, signed in and out). Every finding was reproduced twice; each fix has a regression test
(`regression:` in test/e2e.js, hostile-file cases in test/seq.test.ts and test/cls.test.ts, parity fixtures
`parity-absurd.json` / `parity-unreached.json`, REST validation in DiagramApiTest).

**Fixed**
- Security: unescaped enum-like fields (diagram kind, node kind, sequence message style / block kind, class kind,
  relation type and id) could run script from a crafted file or API document. Documents of every kind are now
  sanitised on load, those fields are escaped, and the server rejects unknown kinds and future versions.
- Data loss: an unreadable cloud diagram opened as a blank one and the next edit overwrote it — it now opens
  read-only. Changing an environment's kind wedged the editor and stopped saving. Repeated node ids across
  tabs/imports wedged the canvas. Labels with `#` or `//` were cut by the sequence text parser. Two windows
  dropped each other's tabs.
- Broken: share links and `?d=` links never opened their diagram; sequence/class JSON couldn't be imported;
  ⌘A-then-drag threw; Delete/undo during a drag crashed; renaming a table orphaned its foreign keys; opening a
  saved tab after reload wrote a version (key order, unstable meta); focusing a field cleared redo and title
  renames weren't undoable; panel stat tiles went stale while typing; double-click on a lifeline didn't rename;
  the drawing jumped sideways when an inline editor took focus; signed-out ≡ went straight to GitHub.
- Wrong numbers: negative or textual quantities, unreachable components counting towards end-to-end latency,
  overflowing loads (NaN), 1e12 shown as "1000000.0M"; sequence top bar always green.
- Phones: page wider than the screen, three-row header, tiny canvas.
- Speed: edge label placement measured every path on every redraw (64% of time at 300 components); typing the
  title redrew the canvas per key.

**Known gaps (features, not defects)** — copy/paste of shapes, right-click menu, PNG/SVG export,
Shift-constrained drag, plain-drag marquee.
