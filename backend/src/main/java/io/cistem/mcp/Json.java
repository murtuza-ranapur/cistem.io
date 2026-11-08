package io.cistem.mcp;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.function.Predicate;

/** Finding and changing things inside a diagram document (JSON). */
final class Json {

    private Json() {}

    static ObjectNode node(JsonNode file, String id) {
        return byId(file.path("model").path("nodes"), id).orElseThrow(() -> new IllegalArgumentException("No such component: " + id));
    }

    static ObjectNode container(JsonNode file, String id) {
        return byId(file.path("model").path("containers"), id).orElseThrow(() -> new IllegalArgumentException("No such container: " + id));
    }

    static java.util.Optional<ObjectNode> byId(JsonNode array, String id) {
        for (JsonNode n : array) if (id.equals(n.path("id").asText())) return java.util.Optional.of((ObjectNode) n);
        return java.util.Optional.empty();
    }

    static ArrayNode array(JsonNode parent, String field) {
        return (ArrayNode) parent.path(field);
    }

    static ObjectNode object(JsonNode parent, String field) {
        return (ObjectNode) parent.path(field);
    }

    /** Remove matching items; true if any were removed. */
    static boolean removeWhere(ArrayNode arr, Predicate<JsonNode> p) {
        boolean any = false;
        for (int i = arr.size() - 1; i >= 0; i--) if (p.test(arr.get(i))) { arr.remove(i); any = true; }
        return any;
    }

    /** The next id with `prefix` (n1, n2, …) not used in `arr`. */
    static String freshId(ArrayNode arr, String prefix) {
        int max = 0;
        for (JsonNode n : arr) {
            String id = n.path("id").asText("");
            if (id.startsWith(prefix)) try { max = Math.max(max, Integer.parseInt(id.substring(prefix.length()))); } catch (NumberFormatException ignored) { /* not ours */ }
        }
        return prefix + (max + 1);
    }

    static boolean blank(String s) {
        return s == null || s.isBlank();
    }
}
