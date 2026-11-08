package io.cistem.mcp;

import io.cistem.diagram.Diagram;
import io.cistem.diagram.DiagramFiles;
import io.cistem.diagram.Notes;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;

import static io.cistem.mcp.Json.*;

/** Class diagrams: classes and relations as JSON. */
@Component
public class ClassDiagramTools {

    private final Diagrams diagrams;
    private final ObjectMapper om;

    public ClassDiagramTools(Diagrams diagrams, ObjectMapper om) {
        this.diagrams = diagrams;
        this.om = om;
    }

    // ---------- class diagrams ----------

    private static final String CLASS_FORMAT = """
            classes: [{name, kind: class|abstract|interface|enum|record, stereo?, fields: [member], methods: [member]}]
              member: {vis: "+"|"-"|"#"|"~"|"", name, type, params? (methods only, e.g. "id: UUID, reason: String"), static?, abstract?}
              enum constants are fields with just a name (vis "", type "").
            relations: [{from, to, type, label?, fromMult?, toMult?}] between class names, type one of:
              composition (from owns to), aggregation (from has to), assoc (from uses to), inherit (from extends to),
              implement (from implements to), depend (from depends on to).
            Class names are unique identifiers (letters, digits, _ $). Positions are worked out by the editor.""";

    @McpTool(name = "create_class_diagram", description = "Create a class diagram. Returns its id.\n" + CLASS_FORMAT)
    public ObjectNode createClassDiagram(@McpToolParam(description = "Title") String title,
                                         @McpToolParam(description = "Classes (see format)") List<Map<String, Object>> classes,
                                         @McpToolParam(description = "Relations (see format)", required = false) List<Map<String, Object>> relations) {
        ObjectNode model = classModel(classes, relations, null);
        ObjectNode file = DiagramFiles.create(om, "class", title);
        file.set("model", model);
        object(file, "layout").putObject("positions");
        return counts(diagrams.savedResult(diagrams.insert(file)), model);
    }

    @McpTool(name = "set_class_diagram", description = "Replace a class diagram's classes and relations. Boxes keep their place when the class name stays the same.\n" + CLASS_FORMAT)
    public ObjectNode setClassDiagram(@McpToolParam(description = "Diagram id") String diagramId,
                                      @McpToolParam(description = "All classes (see format)") List<Map<String, Object>> classes,
                                      @McpToolParam(description = "All relations (see format)", required = false) List<Map<String, Object>> relations) {
        ObjectNode[] model = new ObjectNode[1];
        var saved = diagrams.edit(diagramId, "class", file -> {
            model[0] = classModel(classes, relations, file.path("model").path("relations"));
            Notes.carryOver(file.path("model"), model[0], "classes", "name");
            Notes.carryOver(file.path("model"), model[0], "relations", "id");
            file.set("model", model[0]);
            // boxes of classes that are gone lose their place; the others keep theirs
            Set<String> names = new HashSet<>();
            model[0].path("classes").forEach(c -> names.add(c.path("name").asText()));
            ObjectNode positions = object(file.path("layout"), "positions");
            new ArrayList<>(positions.propertyNames()).forEach(n -> { if (!names.contains(n)) positions.remove(n); });
        });
        return counts(diagrams.savedResult(saved.diagram()), model[0]);
    }

    private static ObjectNode counts(ObjectNode out, JsonNode model) {
        return out.put("classes", model.path("classes").size()).put("relations", model.path("relations").size());
    }

    private static final Set<String> CLASS_KINDS = Set.of("class", "abstract", "interface", "enum", "record");
    private static final Set<String> REL_TYPES = Set.of("composition", "aggregation", "assoc", "inherit", "implement", "depend");
    private static final Set<String> VIS = Set.of("+", "-", "#", "~", "");

    /** Validate and normalise classes + relations; relation ids are kept where from/to/type match an existing one. */
    private ObjectNode classModel(List<Map<String, Object>> classes, List<Map<String, Object>> relations, JsonNode previous) {
        ObjectNode model = om.createObjectNode();
        ArrayNode cs = model.putArray("classes"), rs = model.putArray("relations");
        Set<String> names = new HashSet<>();
        for (Map<String, Object> c : classes == null ? List.<Map<String, Object>>of() : classes) {
            String name = String.valueOf(c.getOrDefault("name", "")).trim();
            if (!name.matches("[A-Za-z_$][\\w$]*")) throw new IllegalArgumentException("Class name \"" + name + "\" must be letters, digits, _ or $");
            if (!names.add(name)) throw new IllegalArgumentException("Class \"" + name + "\" appears twice");
            String kind = String.valueOf(c.getOrDefault("kind", "class"));
            if (!CLASS_KINDS.contains(kind)) throw new IllegalArgumentException(name + ": kind must be one of " + CLASS_KINDS);
            ObjectNode o = cs.addObject(); o.put("name", name).put("kind", kind);
            if (c.get("stereo") != null && !String.valueOf(c.get("stereo")).isBlank()) o.put("stereo", String.valueOf(c.get("stereo")));
            o.set("fields", members(name, c.get("fields"), false, kind.equals("enum")));
            o.set("methods", members(name, c.get("methods"), true, false));
        }
        Map<String, String> oldIds = new HashMap<>();
        if (previous != null) previous.forEach(r -> oldIds.putIfAbsent(r.path("from").asText() + "|" + r.path("to").asText() + "|" + r.path("type").asText(), r.path("id").asText()));
        int n = 0;
        Set<String> used = new HashSet<>();
        for (Map<String, Object> r : relations == null ? List.<Map<String, Object>>of() : relations) {
            String from = String.valueOf(r.get("from")), to = String.valueOf(r.get("to")), type = String.valueOf(r.getOrDefault("type", "assoc"));
            if (!names.contains(from) || !names.contains(to)) throw new IllegalArgumentException("Relation " + from + " → " + to + ": both ends must be classes in the diagram");
            if (!REL_TYPES.contains(type)) throw new IllegalArgumentException("Relation type must be one of " + REL_TYPES);
            String id = oldIds.get(from + "|" + to + "|" + type);
            if (id == null || used.contains(id)) { do id = "m" + (++n); while (used.contains(id) || oldIds.containsValue(id)); }
            used.add(id);
            ObjectNode o = rs.addObject(); o.put("id", id).put("from", from).put("to", to).put("type", type);
            for (String k : List.of("label", "fromMult", "toMult")) if (r.get(k) != null && !String.valueOf(r.get(k)).isBlank()) o.put(k, String.valueOf(r.get(k)));
        }
        return model;
    }
    private ArrayNode members(String owner, Object raw, boolean methods, boolean enumConsts) {
        ArrayNode out = om.createArrayNode();
        if (!(raw instanceof List<?> list)) return out;
        for (Object x : list) {
            ObjectNode m = out.addObject();
            if (x instanceof String s) { m.put("vis", "").put("name", s).put("type", ""); if (methods) m.put("params", ""); continue; }
            if (!(x instanceof Map<?, ?> mm)) throw new IllegalArgumentException(owner + ": members are objects {vis, name, type, params?}");
            String name = String.valueOf(mm.get("name") == null ? "" : mm.get("name")).trim();
            if (!name.matches("[A-Za-z_$][\\w$]*")) throw new IllegalArgumentException(owner + ": member name \"" + name + "\" isn't an identifier");
            String vis = enumConsts ? "" : String.valueOf(mm.get("vis") == null ? (methods ? "+" : "-") : mm.get("vis"));
            if (!VIS.contains(vis)) throw new IllegalArgumentException(owner + "." + name + ": vis must be one of + - # ~ or empty");
            m.put("vis", vis).put("name", name).put("type", enumConsts ? "" : String.valueOf(mm.get("type") == null ? "" : mm.get("type")));
            if (methods) m.put("params", String.valueOf(mm.get("params") == null ? "" : mm.get("params")));
            if (Boolean.TRUE.equals(mm.get("static"))) m.put("static", true);
            if (Boolean.TRUE.equals(mm.get("abstract"))) m.put("abstract", true);
        }
        return out;
    }
}
