package io.cistem.diagram;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Notes in a diagram file (any kind). Canvas notes: content in {@code model.notes}, their boxes in
 * {@code layout.notes}. Item notes: a {@code notes} text field on a component, connection, environment,
 * class, relation or lifeline. Note text is markdown; the browser renders it through its editor's schema,
 * so the server stores it as given (within the size limit).
 */
public final class Notes {

    public static final int MAX_CHARS = 50_000;
    public static final List<String> COLORS = List.of("yellow", "blue", "green", "pink", "grey", "none");

    private Notes() {}

    public static String clean(String text) {
        if (text == null) return "";
        String t = text.replaceAll("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", "");
        return t.length() > MAX_CHARS ? t.substring(0, MAX_CHARS) : t;
    }

    /** Add a canvas note; returns its id. Without a position it goes below everything else. */
    public static String add(ObjectNode file, String text, Double x, Double y, String color) {
        ObjectNode model = (ObjectNode) file.path("model");
        ArrayNode notes = model.has("notes") ? (ArrayNode) model.get("notes") : model.putArray("notes");
        Set<String> taken = new HashSet<>();
        notes.forEach(n -> taken.add(n.path("id").asText()));
        int i = taken.size() + 1;
        while (taken.contains("note" + i)) i++;
        String id = "note" + i;
        notes.addObject().put("id", id).put("color", color(color)).put("text", clean(text));
        ObjectNode layout = file.has("layout") && file.get("layout").isObject() ? (ObjectNode) file.get("layout") : file.putObject("layout");
        ObjectNode boxes = layout.has("notes") ? (ObjectNode) layout.get("notes") : layout.putObject("notes");
        boxes.putObject(id).put("x", x != null ? x : 40).put("y", y != null ? y : lowestY(file) + 60).put("w", 280);
        return id;
    }

    public static void update(ObjectNode file, String id, String text, String color) {
        ObjectNode note = find(file, id);
        if (text != null) note.put("text", clean(text));
        if (color != null) note.put("color", color(color));
    }

    public static void remove(ObjectNode file, String id) {
        find(file, id);
        ArrayNode notes = (ArrayNode) file.path("model").path("notes");
        for (int i = notes.size() - 1; i >= 0; i--) if (id.equals(notes.get(i).path("id").asText())) notes.remove(i);
        if (file.path("layout").path("notes") instanceof ObjectNode boxes) boxes.remove(id);
        if (notes.isEmpty()) {
            ((ObjectNode) file.path("model")).remove("notes");
            if (file.path("layout") instanceof ObjectNode layout) layout.remove("notes");
        }
    }

    /** Set (or with empty text, clear) the notes on an item, found by id (class: by name). */
    public static String setOnItem(ObjectNode file, String itemId, String text) {
        JsonNode model = file.path("model");
        String[][] lists = { {"nodes", "id", "component"}, {"edges", "id", "connection"}, {"containers", "id", "environment"},
                {"participants", "id", "lifeline"}, {"classes", "name", "class"}, {"relations", "id", "relation"} };
        for (String[] l : lists) {
            for (JsonNode item : model.path(l[0])) {
                if (!itemId.equals(item.path(l[1]).asText())) continue;
                String t = clean(text);
                if (t.isBlank()) ((ObjectNode) item).remove("notes"); else ((ObjectNode) item).put("notes", t);
                return l[2];
            }
        }
        throw new IllegalArgumentException("No item with id " + itemId + " (components, connections and environments by id, classes by name, lifelines by id)");
    }

    /** When a whole model is replaced (set_sequence, set_class_diagram), canvas notes and item notes carry over. */
    public static void carryOver(JsonNode previous, ObjectNode next, String list, String key) {
        if (previous.has("notes") && !next.has("notes")) next.set("notes", previous.get("notes").deepCopy());
        for (JsonNode old : previous.path(list)) {
            if (!old.has("notes")) continue;
            for (JsonNode item : next.path(list))
                if (old.path(key).asText().equals(item.path(key).asText()) && !item.has("notes")) ((ObjectNode) item).set("notes", old.get("notes").deepCopy());
        }
    }

    private static ObjectNode find(ObjectNode file, String id) {
        for (JsonNode n : file.path("model").path("notes")) if (id.equals(n.path("id").asText())) return (ObjectNode) n;
        throw new IllegalArgumentException("No such note: " + id);
    }

    private static String color(String c) {
        if (c == null || c.isBlank()) return "yellow";
        if (!COLORS.contains(c)) throw new IllegalArgumentException("color must be one of " + COLORS);
        return c;
    }

    private static double lowestY(ObjectNode file) {
        double max = 0;
        for (JsonNode p : iterable(file.path("layout").path("positions"))) max = Math.max(max, p.path("y").asDouble(0) + 120);
        for (JsonNode p : iterable(file.path("layout").path("notes"))) max = Math.max(max, p.path("y").asDouble(0) + p.path("h").asDouble(160));
        return max;
    }

    private static Iterable<JsonNode> iterable(JsonNode obj) {
        return obj.isObject() ? obj.values() : List.of();
    }
}
