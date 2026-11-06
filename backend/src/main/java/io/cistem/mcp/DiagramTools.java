package io.cistem.mcp;

import io.cistem.api.Diagram;
import io.cistem.api.DiagramRepository;
import io.cistem.engine.Engine;
import io.cistem.engine.Layout;
import org.springframework.ai.mcp.annotation.McpResource;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;

/**
 * MCP tools over the signed-in user's diagrams. Every mutation is read-modify-write with the
 * stored version, so an edit racing the browser fails loudly instead of overwriting it.
 */
@Component
public class DiagramTools {

    static final Set<String> KINDS = Set.of("entry", "lb", "service", "cache", "db", "queue");
    static final Map<String, Map<String, Object>> DEFAULTS = Map.of(
            "entry", Map.of("platforms", List.of("web", "app")),
            "lb", Map.of("maxRps", 50000, "latency", 1),
            "service", Map.of("rpsPerInstance", 800, "instances", 3, "latency", 20, "endpoints", List.of()),
            "cache", Map.of("maxOps", 100000, "hitRatio", 0.9, "latency", 1, "eviction", "allkeys-lru"),
            "db", Map.of("maxQps", 5000, "readShare", 0.8, "replicas", 1, "latency", 8, "tables", List.of()),
            "queue", Map.of("maxThroughput", 20000, "latency", 5, "topics", List.of()));

    private final DiagramRepository repo;
    private final CurrentUser user;
    private final ObjectMapper om;

    public DiagramTools(DiagramRepository repo, CurrentUser user, ObjectMapper om) {
        this.repo = repo;
        this.user = user;
        this.om = om;
    }

    // ---------- read ----------

    @McpTool(name = "list_diagrams", description = "List the user's diagrams: id, title, kind, version, last updated.")
    public List<Diagram.Summary> listDiagrams() {
        return repo.list(user.id());
    }

    @McpTool(name = "get_diagram", description = "Get a diagram's full document (cistem.io file format: version, kind, meta, model, layout).")
    public JsonNode getDiagram(@McpToolParam(description = "Diagram id (UUID)") String diagramId) {
        ObjectNode f = (ObjectNode) load(diagramId).document().deepCopy(); normalise(f); return f;
    }

    @McpTool(name = "evaluate", description = """
            Run the capacity model: propagate the target RPS through the system and report, per component, load vs capacity,
            utilisation %, status (ok / warn ≥70% / crit ≥100%) and effective latency, plus the bottleneck and p50 path latency.
            Optionally override the target RPS for a what-if without saving.""")
    public ObjectNode evaluate(@McpToolParam(description = "Diagram id") String diagramId,
                               @McpToolParam(description = "Target requests/sec to test; omit to use the diagram's own", required = false) Double targetRps) {
        JsonNode file = load(diagramId).document();
        if (targetRps != null) { file = file.deepCopy(); ((ObjectNode) file.path("model")).put("targetRps", targetRps); }
        return Engine.report(file, Engine.compute(file.path("model")), om);
    }

    @McpResource(uri = "cistem://schema", name = "cistem.io diagram schema", description = "JSON Schema (2020-12) for diagram files", mimeType = "application/schema+json")
    public String schema() throws IOException {
        return readSchema();
    }

    private static String readSchema() throws IOException {
        var cp = new ClassPathResource("static/schema/cistem.schema.json");   // bundled with the frontend build
        if (cp.exists()) return cp.getContentAsString(StandardCharsets.UTF_8);
        var local = java.nio.file.Path.of("..", "schema", "cistem.schema.json");   // running from backend/ in dev
        return java.nio.file.Files.readString(local);
    }

    // ---------- create / delete ----------

    @McpTool(name = "create_diagram", description = "Create a new, empty system diagram with a Clients entry node. Returns its id.")
    public Diagram.Summary createDiagram(@McpToolParam(description = "Title") String title,
                                         @McpToolParam(description = "Target requests/sec (default 1000)", required = false) Double targetRps) {
        ObjectNode file = om.createObjectNode();
        file.put("version", 3).put("kind", "system");
        String now = Instant.now().toString();
        file.putObject("meta").put("title", title).put("created", now).put("updated", now);
        ObjectNode model = file.putObject("model");
        model.put("targetRps", targetRps == null ? 1000 : targetRps);
        ArrayNode nodes = model.putArray("nodes"); model.putArray("edges"); model.putArray("containers"); model.putArray("links");
        ObjectNode entry = nodes.addObject(); entry.put("id", "n1").put("kind", "entry").put("name", "Clients").putNull("container"); entry.putArray("platforms").add("web").add("app");
        ObjectNode layout = file.putObject("layout"); layout.putObject("positions").putObject("n1").put("x", 40).put("y", 40); layout.putObject("frames");
        return repo.insert(user.id(), title, "system", file).summary();
    }

    @McpTool(name = "delete_diagram", description = "Delete a diagram permanently.")
    public String deleteDiagram(@McpToolParam(description = "Diagram id") String diagramId) {
        if (!repo.delete(user.id(), uuid(diagramId))) throw new IllegalArgumentException("No such diagram");
        return "deleted";
    }

    // ---------- edit ----------

    @McpTool(name = "set_target_rps", description = "Set the load injected at the entry node.")
    public ObjectNode setTargetRps(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Requests per second") double rps) {
        return edit(diagramId, f -> ((ObjectNode) f.path("model")).put("targetRps", rps));
    }

    @McpTool(name = "rename_diagram", description = "Change the diagram title.")
    public ObjectNode rename(@McpToolParam(description = "Diagram id") String diagramId, @McpToolParam(description = "New title") String title) {
        return edit(diagramId, f -> ((ObjectNode) f.path("meta")).put("title", title));
    }

    @McpTool(name = "add_component", description = """
            Add a component. kind: entry | lb (load balancer) | service | cache (Redis) | db (Postgres) | queue (Kafka).
            properties (optional JSON object) override defaults, e.g. service: {"instances":6,"rpsPerInstance":600,"latency":25};
            cache: {"maxOps":100000,"hitRatio":0.85}; db: {"maxQps":4000,"replicas":2,"readShare":0.85}; queue: {"maxThroughput":20000};
            lb: {"maxRps":50000}. Services may carry "endpoints", dbs "tables", queues "topics" (see the cistem://schema resource).
            Returns the new component id. Position is chosen automatically.""")
    public ObjectNode addComponent(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Component kind") String kind,
                                   @McpToolParam(description = "Display name") String name,
                                   @McpToolParam(description = "Property overrides as a JSON object", required = false) Map<String, Object> properties,
                                   @McpToolParam(description = "Container (environment) id to place it in", required = false) String containerId) {
        if (!KINDS.contains(kind)) throw new IllegalArgumentException("kind must be one of " + KINDS);
        String[] newId = new String[1];
        ObjectNode result = edit(diagramId, f -> {
            ArrayNode nodes = (ArrayNode) f.path("model").path("nodes");
            String id = freshId(nodes, "n");
            newId[0] = id;
            ObjectNode n = nodes.addObject();
            n.put("id", id).put("kind", kind).put("name", name);
            if (containerId != null && !containerId.isBlank()) { container(f, containerId); n.put("container", containerId); } else n.putNull("container");
            Map<String, Object> props = new LinkedHashMap<>(DEFAULTS.get(kind));
            if (properties != null) props.putAll(properties);
            props.forEach((k, v) -> n.set(k, om.valueToTree(v)));
            // place to the right of the current right-most node
            int maxX = 40, y = 40;
            for (var it = f.path("layout").path("positions").properties().iterator(); it.hasNext(); ) {
                var p = it.next().getValue(); if (p.path("x").asInt() >= maxX) { maxX = p.path("x").asInt(); y = p.path("y").asInt(); }
            }
            ((ObjectNode) f.path("layout").path("positions")).putObject(id).put("x", maxX + 320).put("y", y);
        });
        result.put("componentId", newId[0]);
        return result;
    }

    @McpTool(name = "set_properties", description = "Update properties on a component (merge). E.g. {\"instances\": 10} or {\"hitRatio\": 0.95}. Use \"name\" to rename.")
    public ObjectNode setProperties(@McpToolParam(description = "Diagram id") String diagramId,
                                    @McpToolParam(description = "Component id") String componentId,
                                    @McpToolParam(description = "Properties to set, as a JSON object") Map<String, Object> properties) {
        return edit(diagramId, f -> {
            ObjectNode n = node(f, componentId);
            properties.forEach((k, v) -> { if (k.equals("id") || k.equals("kind")) throw new IllegalArgumentException("id and kind can't be changed"); n.set(k, om.valueToTree(v)); });
        });
    }

    @McpTool(name = "remove_component", description = "Remove a component and every edge touching it.")
    public ObjectNode removeComponent(@McpToolParam(description = "Diagram id") String diagramId,
                                      @McpToolParam(description = "Component id") String componentId) {
        return edit(diagramId, f -> {
            node(f, componentId); // existence check
            if ("entry".equals(node(f, componentId).path("kind").asText())) throw new IllegalArgumentException("The entry node can't be removed");
            removeWhere((ArrayNode) f.path("model").path("nodes"), n -> componentId.equals(n.path("id").asText()));
            removeWhere((ArrayNode) f.path("model").path("edges"), e -> componentId.equals(e.path("from").asText()) || componentId.equals(e.path("to").asText()));
            ((ObjectNode) f.path("layout").path("positions")).remove(componentId);
        });
    }

    @McpTool(name = "connect", description = """
            Connect two components with a call edge. calls = downstream calls made per request arriving at `from`
            (e.g. an API that does 2 cache lookups per request: calls=2). Returns the edge id.""")
    public ObjectNode connect(@McpToolParam(description = "Diagram id") String diagramId,
                              @McpToolParam(description = "Source component id") String from,
                              @McpToolParam(description = "Target component id") String to,
                              @McpToolParam(description = "Calls per incoming request (default 1)", required = false) Double calls) {
        String[] newId = new String[1];
        ObjectNode result = edit(diagramId, f -> {
            node(f, from); node(f, to);
            ArrayNode edges = (ArrayNode) f.path("model").path("edges");
            for (JsonNode e : edges) if (from.equals(e.path("from").asText()) && to.equals(e.path("to").asText())) throw new IllegalArgumentException("Already connected (edge " + e.path("id").asText() + "); use set_edge to change calls");
            String id = freshId(edges, "e"); newId[0] = id;
            edges.addObject().put("id", id).put("from", from).put("to", to).put("calls", calls == null ? 1 : calls).putNull("endpoint");
        });
        result.put("edgeId", newId[0]);
        return result;
    }

    @McpTool(name = "set_edge", description = "Change the calls-per-request on an edge.")
    public ObjectNode setEdge(@McpToolParam(description = "Diagram id") String diagramId,
                              @McpToolParam(description = "Edge id") String edgeId,
                              @McpToolParam(description = "Calls per incoming request") double calls) {
        return edit(diagramId, f -> {
            for (JsonNode e : f.path("model").path("edges")) if (edgeId.equals(e.path("id").asText())) { ((ObjectNode) e).put("calls", calls); return; }
            throw new IllegalArgumentException("No such edge");
        });
    }

    @McpTool(name = "disconnect", description = "Remove an edge.")
    public ObjectNode disconnect(@McpToolParam(description = "Diagram id") String diagramId, @McpToolParam(description = "Edge id") String edgeId) {
        return edit(diagramId, f -> {
            ArrayNode edges = (ArrayNode) f.path("model").path("edges");
            int before = edges.size();
            removeWhere(edges, e -> edgeId.equals(e.path("id").asText()));
            if (edges.size() == before) throw new IllegalArgumentException("No such edge");
        });
    }

    @McpTool(name = "auto_organise", description = "Lay the diagram out left-to-right from the entry node (same algorithm as the editor's Auto-organise).")
    public ObjectNode autoOrganise(@McpToolParam(description = "Diagram id") String diagramId) {
        return edit(diagramId, f -> {
            Layout.Result r = Layout.layered(f.path("model"));
            ObjectNode positions = ((ObjectNode) f.path("layout")).putObject("positions");
            r.positions().forEach((id, p) -> positions.putObject(id).put("x", p.x()).put("y", p.y()));
            ObjectNode frames = ((ObjectNode) f.path("layout")).putObject("frames");
            r.frames().forEach((id, fr) -> frames.putObject(id).put("x", fr.x()).put("y", fr.y()).put("w", fr.w()).put("h", fr.h()));
        });
    }

    // ---------- containers (environments) ----------

    @McpTool(name = "list_containers", description = "List the diagram's containers (environments): id, kind, name, parent, provider, owner, and which components are inside.")
    public ArrayNode listContainers(@McpToolParam(description = "Diagram id") String diagramId) {
        JsonNode f = load(diagramId).document();
        ArrayNode out = om.createArrayNode();
        for (JsonNode c : f.path("model").path("containers")) {
            ObjectNode o = out.addObject();
            o.setAll((ObjectNode) c.deepCopy());
            ArrayNode members = o.putArray("components");
            for (JsonNode n : f.path("model").path("nodes")) if (c.path("id").asText().equals(Engine.containerOf(n))) members.add(n.path("id").asText() + " " + n.path("name").asText());
        }
        return out;
    }

    @McpTool(name = "add_container", description = """
            Add a container (environment) that components live in. kind: cloud | account | vpc | region | datacentre | team.
            Nest with parentId (an account inside a cloud, a VPC inside an account). provider e.g. aws, ibm, gcp, on-prem; owner e.g. a team or company.
            Calls between components in different containers pick up latency: 0 ms inside one container, 1 ms between siblings,
            10 ms between different clouds, or whatever link_containers declares. Returns the new container id.""")
    public ObjectNode addContainer(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Container kind") String kind,
                                   @McpToolParam(description = "Display name") String name,
                                   @McpToolParam(description = "Enclosing container id", required = false) String parentId,
                                   @McpToolParam(description = "Provider (aws, ibm, gcp, on-prem...)", required = false) String provider,
                                   @McpToolParam(description = "Owning team or company", required = false) String owner) {
        if (!CONTAINER_KINDS.contains(kind)) throw new IllegalArgumentException("kind must be one of " + CONTAINER_KINDS);
        String[] newId = new String[1];
        ObjectNode result = edit(diagramId, f -> {
            ArrayNode cs = (ArrayNode) f.path("model").path("containers");
            if (parentId != null && !parentId.isBlank()) container(f, parentId);
            String id = freshId(cs, "c"); newId[0] = id;
            ObjectNode c = cs.addObject();
            c.put("id", id).put("kind", kind).put("name", name);
            if (parentId != null && !parentId.isBlank()) c.put("parent", parentId); else c.putNull("parent");
            if (provider != null && !provider.isBlank()) c.put("provider", provider);
            if (owner != null && !owner.isBlank()) c.put("owner", owner);
        });
        result.put("containerId", newId[0]);
        return result;
    }

    @McpTool(name = "set_container", description = "Update a container: name, kind, parentId (null/empty = top level), provider, owner, note.")
    public ObjectNode setContainer(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Container id") String containerId,
                                   @McpToolParam(description = "Properties to set, as a JSON object (name, kind, parent, provider, owner, note)") Map<String, Object> properties) {
        return edit(diagramId, f -> {
            ObjectNode c = container(f, containerId);
            properties.forEach((k, v) -> {
                if (k.equals("id")) throw new IllegalArgumentException("id can't be changed");
                if (k.equals("kind") && !CONTAINER_KINDS.contains(String.valueOf(v))) throw new IllegalArgumentException("kind must be one of " + CONTAINER_KINDS);
                if (k.equals("parent")) {
                    String p = v == null || String.valueOf(v).isBlank() ? null : String.valueOf(v);
                    if (p != null) { container(f, p); if (Engine.ancestry(f.path("model"), p).contains(containerId)) throw new IllegalArgumentException("A container can't be inside itself"); }
                    if (p == null) c.putNull("parent"); else c.put("parent", p);
                } else c.set(k, om.valueToTree(v));
            });
        });
    }

    @McpTool(name = "move_component", description = "Move a component into a container (environment), or out of all containers with an empty containerId.")
    public ObjectNode moveComponent(@McpToolParam(description = "Diagram id") String diagramId,
                                    @McpToolParam(description = "Component id") String componentId,
                                    @McpToolParam(description = "Target container id; empty for none", required = false) String containerId) {
        return edit(diagramId, f -> {
            ObjectNode n = node(f, componentId);
            if (containerId == null || containerId.isBlank()) n.putNull("container");
            else { container(f, containerId); n.put("container", containerId); }
        });
    }

    @McpTool(name = "remove_container", description = "Remove a container. Its components and nested containers move up to its parent; its links are dropped.")
    public ObjectNode removeContainer(@McpToolParam(description = "Diagram id") String diagramId, @McpToolParam(description = "Container id") String containerId) {
        return edit(diagramId, f -> {
            ObjectNode c = container(f, containerId);
            JsonNode parent = c.path("parent");
            for (JsonNode n : f.path("model").path("nodes")) if (containerId.equals(Engine.containerOf(n))) { if (parent.isTextual()) ((ObjectNode) n).set("container", parent); else ((ObjectNode) n).putNull("container"); }
            for (JsonNode k : f.path("model").path("containers")) if (containerId.equals(k.path("parent").asText(null))) { if (parent.isTextual()) ((ObjectNode) k).set("parent", parent); else ((ObjectNode) k).putNull("parent"); }
            removeWhere((ArrayNode) f.path("model").path("links"), l -> containerId.equals(l.path("from").asText()) || containerId.equals(l.path("to").asText()));
            removeWhere((ArrayNode) f.path("model").path("containers"), k -> containerId.equals(k.path("id").asText()));
            ((ObjectNode) f.path("layout").path("frames")).remove(containerId);
        });
    }

    @McpTool(name = "link_containers", description = """
            Declare how two containers talk and the latency that adds to every call crossing between them (or anything nested in them).
            type: same-network (0 ms) | vpc-peering (1) | privatelink (2) | transit-gateway (3) | direct-connect (10) | vpn (20) | public-internet (40) | free text.
            latencyMs overrides the type's default. Replaces an existing link between the same pair.""")
    public ObjectNode linkContainers(@McpToolParam(description = "Diagram id") String diagramId,
                                     @McpToolParam(description = "Container id") String fromId,
                                     @McpToolParam(description = "Container id") String toId,
                                     @McpToolParam(description = "Link type") String type,
                                     @McpToolParam(description = "Added latency in ms", required = false) Double latencyMs) {
        String[] newId = new String[1];
        ObjectNode result = edit(diagramId, f -> {
            container(f, fromId); container(f, toId);
            if (fromId.equals(toId)) throw new IllegalArgumentException("from and to must differ");
            ArrayNode links = (ArrayNode) f.path("model").path("links");
            removeWhere(links, l -> (fromId.equals(l.path("from").asText()) && toId.equals(l.path("to").asText())) || (toId.equals(l.path("from").asText()) && fromId.equals(l.path("to").asText())));
            String id = freshId(links, "l"); newId[0] = id;
            double ms = latencyMs != null ? latencyMs : LINK_DEFAULTS.getOrDefault(type, 5.0);
            links.addObject().put("id", id).put("from", fromId).put("to", toId).put("type", type).put("latencyMs", ms);
        });
        result.put("linkId", newId[0]);
        return result;
    }

    @McpTool(name = "unlink_containers", description = "Remove the link between two containers (they fall back to the default crossing latency).")
    public ObjectNode unlinkContainers(@McpToolParam(description = "Diagram id") String diagramId,
                                       @McpToolParam(description = "Container id") String fromId,
                                       @McpToolParam(description = "Container id") String toId) {
        return edit(diagramId, f -> {
            ArrayNode links = (ArrayNode) f.path("model").path("links");
            int before = links.size();
            removeWhere(links, l -> (fromId.equals(l.path("from").asText()) && toId.equals(l.path("to").asText())) || (toId.equals(l.path("from").asText()) && fromId.equals(l.path("to").asText())));
            if (links.size() == before) throw new IllegalArgumentException("No link between those containers");
        });
    }

    static final Set<String> CONTAINER_KINDS = Set.of("cloud", "account", "vpc", "region", "datacentre", "team");
    static final Map<String, Double> LINK_DEFAULTS = Map.of("same-network", 0.0, "vpc-peering", 1.0, "privatelink", 2.0, "transit-gateway", 3.0, "vpn", 20.0, "direct-connect", 10.0, "public-internet", 40.0);

    private static ObjectNode container(JsonNode file, String id) {
        for (JsonNode c : file.path("model").path("containers")) if (id.equals(c.path("id").asText())) return (ObjectNode) c;
        throw new IllegalArgumentException("No such container: " + id);
    }

    // ---------- helpers ----------

    private Diagram load(String id) {
        return repo.find(user.id(), uuid(id)).orElseThrow(() -> new IllegalArgumentException("No such diagram: " + id));
    }

    /** Read-modify-write with optimistic concurrency, then return a summary + evaluation so the agent sees the effect. */
    private ObjectNode edit(String diagramId, Consumer<JsonNode> change) {
        Diagram d = load(diagramId);
        JsonNode file = d.document().deepCopy();
        normalise((ObjectNode) file);
        change.accept(file);
        ((ObjectNode) file.path("meta")).put("updated", Instant.now().toString());
        String title = file.path("meta").path("title").asText(d.title());
        Diagram saved = repo.update(user.id(), d.id(), d.version(), title, file)
                .orElseThrow(() -> new IllegalStateException("The diagram changed while editing; read it again and retry"));
        ObjectNode out = om.createObjectNode();
        out.put("diagramId", saved.id().toString()).put("version", saved.version());
        out.set("evaluation", Engine.report(file, Engine.compute(file.path("model")), om));
        return out;
    }

    /** Bring a stored v2 document up to v3 shape in memory (the browser does the same on load). */
    private static void normalise(ObjectNode file) {
        ObjectNode model = (ObjectNode) file.path("model");
        if (!model.has("containers")) model.putArray("containers");
        if (!model.has("links")) model.putArray("links");
        ObjectNode layout = file.has("layout") ? (ObjectNode) file.path("layout") : file.putObject("layout");
        if (!layout.has("positions")) layout.putObject("positions");
        if (!layout.has("frames")) layout.putObject("frames");
        if (file.path("version").asInt(0) < 3) file.put("version", 3);
    }

    private static ObjectNode node(JsonNode file, String id) {
        for (JsonNode n : file.path("model").path("nodes")) if (id.equals(n.path("id").asText())) return (ObjectNode) n;
        throw new IllegalArgumentException("No such component: " + id);
    }

    private static void removeWhere(ArrayNode arr, java.util.function.Predicate<JsonNode> p) {
        for (int i = arr.size() - 1; i >= 0; i--) if (p.test(arr.get(i))) arr.remove(i);
    }

    private static String freshId(ArrayNode arr, String prefix) {
        int max = 0;
        for (JsonNode n : arr) { String id = n.path("id").asText(""); if (id.startsWith(prefix)) try { max = Math.max(max, Integer.parseInt(id.substring(prefix.length()))); } catch (NumberFormatException ignored) {} }
        return prefix + (max + 1);
    }

    private static UUID uuid(String s) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException e) { throw new IllegalArgumentException("Not a diagram id: " + s); }
    }
}
