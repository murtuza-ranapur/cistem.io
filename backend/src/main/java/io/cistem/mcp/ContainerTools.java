package io.cistem.mcp;

import io.cistem.engine.Engine;
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

/** Containers (environments) in a system diagram, and the links between them. */
@Component
public class ContainerTools {

    private final Diagrams diagrams;
    private final ObjectMapper om;

    public ContainerTools(Diagrams diagrams, ObjectMapper om) {
        this.diagrams = diagrams;
        this.om = om;
    }

    @McpTool(name = "list_containers", description = "List the diagram's containers (environments): id, kind, name, parent, provider, owner, and which components are inside.")
    public ArrayNode listContainers(@McpToolParam(description = "Diagram id") String diagramId) {
        JsonNode f = diagrams.read(diagramId, "system");
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

    static final Set<String> CONTAINER_COLORS = Set.of("blue", "violet", "teal", "green", "amber", "orange", "red", "pink", "slate");

    @McpTool(name = "set_container", description = """
            Update a container: name, kind, parent (null/empty = top level), provider, owner, note, and its look:
            color (blue | violet | teal | green | amber | orange | red | pink | slate), fill (tint | solid | outline), border (dashed | solid).""")
    public ObjectNode setContainer(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "Container id") String containerId,
                                   @McpToolParam(description = "Properties to set, as a JSON object (name, kind, parent, provider, owner, note, color, fill, border)") Map<String, Object> properties) {
        return edit(diagramId, f -> {
            ObjectNode c = container(f, containerId);
            properties.forEach((k, v) -> {
                if (k.equals("id")) throw new IllegalArgumentException("id can't be changed");
                if (k.equals("kind") && !CONTAINER_KINDS.contains(String.valueOf(v))) throw new IllegalArgumentException("kind must be one of " + CONTAINER_KINDS);
                if (k.equals("color") && v != null && !CONTAINER_COLORS.contains(String.valueOf(v))) throw new IllegalArgumentException("color must be one of " + CONTAINER_COLORS);
                if (k.equals("fill") && v != null && !Set.of("tint", "solid", "outline").contains(String.valueOf(v))) throw new IllegalArgumentException("fill must be tint, solid or outline");
                if (k.equals("border") && v != null && !Set.of("dashed", "solid").contains(String.valueOf(v))) throw new IllegalArgumentException("border must be dashed or solid");
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


    private ObjectNode edit(String diagramId, Consumer<ObjectNode> change) {
        return diagrams.editSystem(diagramId, change);
    }
}
