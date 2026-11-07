package io.cistem.engine;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Component types, from shared/component-types.json (the same file the browser reads). The engine and layout
 * work from a type's behaviour and detail, never its name, so adding a type needs no Java change.
 */
public final class Types {
    public record Type(String key, String label, String behaviour, String detail, int width, JsonNode defaults) {}

    private static final Map<String, Type> TYPES = load();
    private static final Type UNKNOWN = new Type("?", "Component", "limit", null, 200, null);

    private Types() {}

    private static Map<String, Type> load() {
        try (InputStream in = Types.class.getResourceAsStream("/component-types.json")) {
            if (in == null) throw new IllegalStateException("component-types.json is not on the classpath");
            JsonNode root = new ObjectMapper().readTree(in);
            Map<String, Type> out = new LinkedHashMap<>();
            root.path("types").properties().forEach(e -> {
                JsonNode t = e.getValue();
                out.put(e.getKey(), new Type(e.getKey(), t.path("label").asText(e.getKey()), t.path("behaviour").asText("limit"),
                        t.path("detail").isTextual() ? t.path("detail").asText() : null, t.path("w").asInt(200), t.path("defaults")));
            });
            return Map.copyOf(out);
        } catch (java.io.IOException e) { throw new IllegalStateException(e); }
    }

    public static Map<String, Type> all() { return TYPES; }
    public static Type of(String kind) { return TYPES.getOrDefault(kind, UNKNOWN); }
    public static boolean known(String kind) { return TYPES.containsKey(kind); }
    public static String behaviour(JsonNode n) { return of(n.path("kind").asText()).behaviour(); }
    public static String detail(JsonNode n) { return of(n.path("kind").asText()).detail(); }
    public static boolean isSource(JsonNode n) { return "source".equals(behaviour(n)); }
    public static boolean isAsync(JsonNode n) { return "async".equals(behaviour(n)); }
}
