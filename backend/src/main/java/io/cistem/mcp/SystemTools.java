package io.cistem.mcp;

import io.cistem.diagram.Diagram;
import io.cistem.diagram.DiagramFiles;
import io.cistem.engine.Engine;
import io.cistem.engine.Layout;
import io.cistem.engine.Types;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;
import java.util.function.Consumer;

import static io.cistem.mcp.Json.*;

/** System diagrams: components, connections, load and the capacity model. */
@Component
public class SystemTools {

    private final Diagrams diagrams;
    private final ObjectMapper om;

    public SystemTools(Diagrams diagrams, ObjectMapper om) {
        this.diagrams = diagrams;
        this.om = om;
    }

    @McpTool(name = "evaluate", description = """
            Run the capacity model: inject each Clients node's peak rps, propagate it through the system and report, per
            component, load vs capacity, utilisation %, status (ok / warn ≥70% / crit ≥100%) and effective latency, plus the
            bottleneck, total rps and p50 path latency. Optionally test a different total load (clients scaled
            proportionally) as a what-if, without saving.""")
    public ObjectNode evaluate(@McpToolParam(description = "Diagram id") String diagramId,
                               @McpToolParam(description = "What-if total requests/sec across all clients; omit to use the clients' own", required = false) Double targetRps) {
        ObjectNode file = diagrams.read(diagramId, "system");
        if (targetRps != null) scaleClients(file, targetRps);
        return Engine.report(file, Engine.compute(file.path("model")), om);
    }

    /** Set the clients' peak rps so they add up to `total`, keeping their proportions (equal split if all are 0). */
    private static void scaleClients(JsonNode file, double total) {
        List<ObjectNode> clients = new java.util.ArrayList<>();
        for (JsonNode n : file.path("model").path("nodes")) if (Types.isSource(n)) clients.add((ObjectNode) n);
        if (clients.isEmpty()) throw new IllegalArgumentException("This diagram has no Clients component to carry the load");
        double sum = clients.stream().mapToDouble(c -> c.path("rps").asDouble(0)).sum();
        for (ObjectNode c : clients) c.put("rps", sum > 0 ? c.path("rps").asDouble(0) * total / sum : total / clients.size());
    }

    @McpTool(name = "create_diagram", description = "Create a new, empty system diagram with one Clients node, in the given project or the user's default one. Returns its id and projectId.")
    public Diagram.Summary createDiagram(@McpToolParam(description = "Title") String title,
                                         @McpToolParam(description = "Peak requests/sec of the Clients node (default 1000)", required = false) Double targetRps,
                                         @McpToolParam(description = Diagrams.PROJECT_PARAM, required = false) String projectId) {
        ObjectNode file = DiagramFiles.create(om, "system", title);
        ObjectNode model = object(file, "model");
        ArrayNode nodes = model.putArray("nodes");
        model.putArray("edges"); model.putArray("containers"); model.putArray("links");
        ObjectNode entry = nodes.addObject();
        entry.put("id", "n1").put("kind", "entry").put("name", "Clients").put("rps", targetRps == null ? 1000 : targetRps).putNull("container");
        entry.putArray("platforms").add("web").add("app");
        ObjectNode layout = object(file, "layout");
        layout.putObject("positions").putObject("n1").put("x", 40).put("y", 40);
        layout.putObject("frames");
        return diagrams.insert(file, projectId).summary();
    }

    @McpTool(name = "list_component_types", description = """
            The component types a system diagram can use: key, label, behaviour (how the capacity model treats it:
            source | balancer | limit | scaled | cache | store | async), what it expands to show, and its default fields.""")
    public ArrayNode listComponentTypes() {
        ArrayNode out = om.createArrayNode();
        Types.all().values().forEach(t -> {
            ObjectNode o = out.addObject();
            o.put("kind", t.key()).put("label", t.label()).put("behaviour", t.behaviour());
            if (t.detail() != null) o.put("detail", t.detail()); else o.putNull("detail");
            o.set("defaults", t.defaults());
        });
        return out;
    }

    @McpTool(name = "set_client_rps", description = "Set one Clients component's peak requests/sec (the load it sends into the system).")
    public ObjectNode setClientRps(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Clients component id") String componentId,
                                   @McpToolParam(description = "Peak requests per second") double rps) {
        return edit(diagramId, f -> {
            ObjectNode n = node(f, componentId);
            if (!Types.isSource(n)) throw new IllegalArgumentException(componentId + " is not a Clients component");
            n.put("rps", rps);
        });
    }

    @McpTool(name = "set_target_rps", description = """
            Set the total peak load: with one Clients component it gets this rps; with several they're scaled to add up to it,
            keeping their proportions. (Use set_client_rps to set one client.)""")
    public ObjectNode setTargetRps(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Total requests per second") double rps) {
        return edit(diagramId, f -> scaleClients(f, rps));
    }

    @McpTool(name = "add_component", description = """
            Add a component. kind is a component type key — list_component_types gives them all with their behaviour and
            fields; common ones: entry (Clients) | lb | apigw | cdn | service | cache (Redis) | db (Postgres) | mongodb | queue (one Kafka topic) | sqs.
            properties (optional JSON object) override defaults, e.g. entry: {"rps":2000}; service: {"instances":6,"rpsPerInstance":600,"latency":25};
            cache: {"maxOps":100000,"hitRatio":0.85}; db: {"maxQps":4000,"replicas":2,"readShare":0.85};
            queue: {"partitions":12,"msgPerPartition":3000,"key":"paymentId","cluster":"msk-payments","schema":"<Avro JSON>"} (capacity = partitions × msgPerPartition; a service that only consumes topics uses at most one instance per partition) — name it with the topic name;
            lb: {"maxRps":50000}. Services may carry "endpoints", dbs "tables" (see the cistem://schema resource).
            Returns the new component id. Position is chosen automatically.""")
    public ObjectNode addComponent(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Component kind") String kind,
                                   @McpToolParam(description = "Display name") String name,
                                   @McpToolParam(description = "Property overrides as a JSON object", required = false) Map<String, Object> properties,
                                   @McpToolParam(description = "Container (environment) id to place it in", required = false) String containerId) {
        if (!Types.known(kind)) throw new IllegalArgumentException("kind must be one of " + Types.all().keySet() + " (see list_component_types)");
        String[] newId = new String[1];
        ObjectNode result = edit(diagramId, f -> {
            ArrayNode nodes = (ArrayNode) f.path("model").path("nodes");
            String id = freshId(nodes, "n");
            newId[0] = id;
            ObjectNode n = nodes.addObject();
            n.put("id", id).put("kind", kind).put("name", name);
            if (containerId != null && !containerId.isBlank()) { container(f, containerId); n.put("container", containerId); } else n.putNull("container");
            Map<String, Object> props = new LinkedHashMap<>();
            Types.of(kind).defaults().properties().forEach(e -> { if (!e.getKey().equals("name")) props.put(e.getKey(), om.treeToValue(e.getValue(), Object.class)); });
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

    @McpTool(name = "set_edge", description = "Change a connection: the target's endpoints it calls (each with its own calls per request), calls per request when it lists no endpoints, the label shown on the line (empty string removes it), whether its notes show on the line, and its style. Omit what you don't change.")
    public ObjectNode setEdge(@McpToolParam(description = "Diagram id") String diagramId,
                              @McpToolParam(description = "Edge id") String edgeId,
                              @McpToolParam(description = "Calls per incoming request (only for a connection that lists no endpoints)", required = false) Double calls,
                              @McpToolParam(description = "Endpoints of the target this connection calls, each \"METHOD /path\" with optional calls per request as \" x4\" (default 1), e.g. [\"POST /v1/uploads\", \"GET /v1/uploads/{id} x4\"]; [] clears them", required = false) List<String> endpoints,
                              @McpToolParam(description = "Text shown on the line, newlines start new lines; \"\" removes it", required = false) String label,
                              @McpToolParam(description = "Show the connection's notes on the line under the label", required = false) Boolean showNotes,
                              @McpToolParam(description = "Line: solid, dashed or dotted (\"default\" resets)", required = false) String line,
                              @McpToolParam(description = "Colour: blue, violet, teal, green, amber, orange, red, pink, slate (\"default\" resets)", required = false) String color,
                              @McpToolParam(description = "Width: thin, medium or thick", required = false) String width,
                              @McpToolParam(description = "Arrows: end, both or none", required = false) String arrows) {
        return edit(diagramId, f -> {
            for (JsonNode n : f.path("model").path("edges")) {
                if (!edgeId.equals(n.path("id").asText())) continue;
                ObjectNode e = (ObjectNode) n;
                if (endpoints != null) setEndpoints(f, e, endpoints);
                if (calls != null) {
                    if (e.path("endpoints").isArray() && !e.path("endpoints").isEmpty()) throw new IllegalArgumentException("This connection lists endpoints: set calls per endpoint with endpoints, e.g. \"GET /v1/x x4\"");
                    e.put("calls", calls);
                }
                if (label != null) { if (label.isBlank()) e.remove("label"); else e.put("label", label.length() > 500 ? label.substring(0, 500) : label); }
                if (showNotes != null) { if (showNotes) e.put("showNotes", true); else e.remove("showNotes"); }
                style(e, "line", line, Set.of("solid", "dashed", "dotted"), "default");
                style(e, "color", color, Set.of("blue", "violet", "teal", "green", "amber", "orange", "red", "pink", "slate"), "default");
                style(e, "width", width, Set.of("thin", "thick"), "medium");
                style(e, "arrows", arrows, Set.of("both", "none"), "end");
                return;
            }
            throw new IllegalArgumentException("No such edge");
        });
    }

    /** Point the connection at these endpoints of its target ("METHOD /path [xN]"); calls becomes their sum. */
    private static void setEndpoints(JsonNode file, ObjectNode e, List<String> wanted) {
        if (wanted.isEmpty()) { e.remove("endpoints"); return; }
        JsonNode target = null;
        for (JsonNode n : file.path("model").path("nodes")) if (e.path("to").asText().equals(n.path("id").asText())) target = n;
        JsonNode eps = target == null ? null : target.path("endpoints");
        if (eps == null || !eps.isArray() || eps.isEmpty()) throw new IllegalArgumentException("The target has no endpoints; add them with set_properties first");
        ArrayNode out = e.putArray("endpoints");
        double sum = 0; Set<Integer> seen = new HashSet<>();
        for (String w : wanted) {
            var m = java.util.regex.Pattern.compile("^\\s*(\\S+)\\s+(\\S+?)(?:\\s+[x×*]\\s*([0-9.]+))?\\s*$").matcher(w);
            if (!m.matches()) throw new IllegalArgumentException("Endpoint \"" + w + "\" should look like \"GET /v1/path\" or \"GET /v1/path x4\"");
            String method = m.group(1).toUpperCase(), path = m.group(2);
            double c = m.group(3) == null ? 1 : Double.parseDouble(m.group(3));
            int found = -1;
            for (int i = 0; i < eps.size(); i++) if (method.equals(eps.get(i).path("method").asText().toUpperCase()) && path.equals(eps.get(i).path("path").asText())) { found = i; break; }
            if (found < 0) {
                List<String> have = new ArrayList<>(); for (JsonNode x : eps) have.add(x.path("method").asText() + " " + x.path("path").asText());
                throw new IllegalArgumentException("No endpoint " + method + " " + path + " on the target; it has " + have);
            }
            if (!seen.add(found)) continue;
            out.addObject().put("i", found).put("calls", c);
            sum += c;
        }
        e.put("calls", sum);
    }

    /** Set `key` to `value` when it's one of `allowed`; `reset` (or "default") removes it. */
    private static void style(ObjectNode e, String key, String value, Set<String> allowed, String reset) {
        if (value == null) return;
        String v = value.trim().toLowerCase();
        if (v.equals(reset) || v.equals("default") || v.isEmpty()) e.remove(key);
        else if (allowed.contains(v)) e.put(key, v);
        else throw new IllegalArgumentException(key + " must be one of " + allowed + " or " + reset);
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
            Layout.Result r = Layout.layered(f.path("model"), f.path("layout").path("detail"));
            ObjectNode positions = ((ObjectNode) f.path("layout")).putObject("positions");
            r.positions().forEach((id, p) -> positions.putObject(id).put("x", p.x()).put("y", p.y()));
            ObjectNode frames = ((ObjectNode) f.path("layout")).putObject("frames");
            r.frames().forEach((id, fr) -> frames.putObject(id).put("x", fr.x()).put("y", fr.y()).put("w", fr.w()).put("h", fr.h()));
        });
    }

    private ObjectNode edit(String diagramId, Consumer<ObjectNode> change) {
        return diagrams.editSystem(diagramId, change);
    }
}
