package io.cistem.diagram;

import io.cistem.engine.Migrate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.Set;

/**
 * The cistem.dev file format (schema/cistem.schema.json) as the server sees it: checking an uploaded file,
 * reading its title and kind, starting new files, and bringing stored ones up to the current version.
 */
public final class DiagramFiles {

    public static final Set<String> KINDS = Set.of("system", "sequence", "class");

    private DiagramFiles() {}

    /** Throws {@link IllegalArgumentException} describing the first problem with an uploaded file. */
    public static void validate(JsonNode document) {
        if (document == null || !document.isObject()) throw new IllegalArgumentException("document must be a JSON object");
        if (!document.path("version").isInt()) throw new IllegalArgumentException("document.version is required");
        if (!document.path("kind").isTextual()) throw new IllegalArgumentException("document.kind is required");
        if (!KINDS.contains(kind(document))) throw new IllegalArgumentException("document.kind must be one of " + KINDS);
        int v = document.path("version").asInt();
        if (v < 1 || v > Migrate.VERSION) throw new IllegalArgumentException("document.version must be between 1 and " + Migrate.VERSION);
        if (!document.path("model").isObject()) throw new IllegalArgumentException("document.model is required");
    }

    public static String title(JsonNode document) {
        JsonNode t = document.path("meta").path("title");
        return t.isTextual() && !t.asText().isBlank() ? t.asText() : "Untitled";
    }

    public static String kind(JsonNode document) {
        JsonNode k = document.path("kind");
        return k.isTextual() ? k.asText() : "system";
    }

    /** A new file of `kind` with a title and timestamps; the caller fills in the model and layout. */
    public static ObjectNode create(ObjectMapper om, String kind, String title) {
        ObjectNode file = om.createObjectNode();
        file.put("version", Migrate.VERSION).put("kind", kind);
        String now = Instant.now().toString();
        file.putObject("meta").put("title", title).put("created", now).put("updated", now);
        file.putObject("model");
        file.putObject("layout");
        return file;
    }

    public static void touch(ObjectNode file) {
        ((ObjectNode) file.path("meta")).put("updated", Instant.now().toString());
    }

    /** Bring a stored document up to the current version in memory (the browser does the same on load). */
    public static ObjectNode normalise(ObjectNode file) {
        switch (kind(file)) {
            case "class" -> {
                ObjectNode model = object(file, "model");
                array(model, "classes"); array(model, "relations");
                if (!object(file, "layout").has("positions")) ((ObjectNode) file.get("layout")).putObject("positions");
            }
            case "sequence" -> {
                ObjectNode model = object(file, "model");
                array(model, "participants"); array(model, "rows");
                object(file, "layout");
            }
            default -> Migrate.toCurrent(file);
        }
        return file;
    }

    /** The tools for one kind refuse the others, and say which tools to use instead. */
    public static void requireKind(JsonNode file, String wanted) {
        String kind = kind(file);
        if (kind.equals(wanted)) return;
        if (wanted.equals("system"))
            throw new IllegalArgumentException("This is a " + kind + " diagram; component, container and capacity tools only apply to system diagrams."
                    + switch (kind) {
                        case "sequence" -> " Use get_sequence / set_sequence to read and change it.";
                        case "class" -> " Use get_diagram to read it and set_class_diagram to change it.";
                        default -> "";
                    });
        throw new IllegalArgumentException("Not a " + wanted + " diagram (it's a " + kind + " diagram)");
    }

    private static ObjectNode object(ObjectNode parent, String field) {
        return parent.get(field) instanceof ObjectNode o ? o : parent.putObject(field);
    }

    private static void array(ObjectNode parent, String field) {
        if (!parent.has(field)) parent.putArray(field);
    }

}
