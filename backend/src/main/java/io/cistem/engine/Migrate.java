package io.cistem.engine;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.HashSet;
import java.util.Set;

/**
 * Brings stored documents up to the current file version in memory (mirror of src/document.ts migrations).
 * The browser migrates on load as well and saves the new shape on its next autosave.
 */
public final class Migrate {
    public static final int VERSION = 4;
    private Migrate() {}

    public static void toCurrent(ObjectNode file) {
        ObjectNode model = (ObjectNode) file.path("model");
        if (!model.has("containers")) model.putArray("containers");
        if (!model.has("links")) model.putArray("links");
        ObjectNode layout = file.has("layout") ? (ObjectNode) file.path("layout") : file.putObject("layout");
        if (!layout.has("positions")) layout.putObject("positions");
        if (!layout.has("frames")) layout.putObject("frames");
        if (file.path("version").asInt(0) < 4) v3to4(file);
        file.put("version", VERSION);
    }

    /** Load moves onto each Clients node; a Kafka node becomes one topic (extra topics split into new nodes). */
    static void v3to4(ObjectNode file) {
        ObjectNode model = (ObjectNode) file.path("model");
        ObjectNode positions = (ObjectNode) file.path("layout").path("positions");
        JsonNode target = model.path("targetRps").isNumber() ? model.path("targetRps") : tools.jackson.databind.node.IntNode.valueOf(1000);
        ArrayNode nodes = (ArrayNode) model.path("nodes"), edges = (ArrayNode) model.path("edges");
        Set<String> ids = new HashSet<>();
        nodes.forEach(n -> ids.add(n.path("id").asText()));
        edges.forEach(e -> ids.add(e.path("id").asText()));
        int[] seq = {1};
        java.util.function.Function<String, String> fresh = base -> { String id; do id = base + "t" + seq[0]++; while (!ids.add(id)); return id; };
        for (int i = 0; i < nodes.size(); i++) {
            ObjectNode n = (ObjectNode) nodes.get(i);
            String kind = n.path("kind").asText();
            if ("entry".equals(kind) && !n.has("rps")) n.set("rps", target.deepCopy());
            if (!"queue".equals(kind) || !n.has("topics")) continue;
            JsonNode topics = n.remove("topics");
            String oldName = n.path("name").asText("");
            if (topics.isEmpty()) { if (!n.has("partitions")) n.put("partitions", 6); if (!n.has("schema")) n.put("schema", ""); continue; }
            applyTopic(n, topics.get(0), oldName);
            JsonNode p = positions.path(n.path("id").asText());
            int inserted = topics.size() - 1;
            for (int t = 1; t < topics.size(); t++) {
                ObjectNode copy = n.deepCopy();
                copy.remove(java.util.List.of("key", "cluster"));
                String id = fresh.apply(n.path("id").asText());
                copy.put("id", id);
                applyTopic(copy, topics.get(t), oldName);
                nodes.insert(i + t, copy);   // right after the original, like src/document.ts
                ObjectNode pos = positions.putObject(id);
                pos.set("x", p.path("x").isNumber() ? p.path("x").deepCopy() : tools.jackson.databind.node.IntNode.valueOf(0));
                double y = p.path("y").asDouble(0) + t * 132;
                if (y == Math.rint(y) && Math.abs(y) < Integer.MAX_VALUE) pos.put("y", (int) y); else pos.put("y", y);
                int ec = edges.size();
                for (int k = 0; k < ec; k++) {
                    JsonNode e = edges.get(k);
                    if (e.path("from").asText().equals(n.path("id").asText())) { ObjectNode c = (ObjectNode) e.deepCopy(); c.put("id", fresh.apply(e.path("id").asText())); c.put("from", id); edges.add(c); }
                    else if (e.path("to").asText().equals(n.path("id").asText())) { ObjectNode c = (ObjectNode) e.deepCopy(); c.put("id", fresh.apply(e.path("id").asText())); c.put("to", id); edges.add(c); }
                }
            }
            i += inserted;   // the split topics were inserted right after; don't migrate them again
        }
        model.remove("targetRps");
    }

    private static void applyTopic(ObjectNode n, JsonNode t, String oldName) {
        String name = t.path("name").asText("");
        n.put("name", name.isEmpty() ? oldName : name);
        n.put("partitions", t.path("partitions").asInt(6));
        n.put("schema", t.path("schema").asText(""));
        if (t.path("key").isTextual() && !t.path("key").asText().isEmpty()) n.put("key", t.path("key").asText());
        if (!name.isEmpty() && !oldName.isEmpty() && !name.equals(oldName)) n.put("cluster", oldName);
    }
}
