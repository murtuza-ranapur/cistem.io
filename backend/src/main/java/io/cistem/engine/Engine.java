package io.cistem.engine;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;

/**
 * Capacity model. Port of src/engine.ts; test/resources/parity.json pins both to the same numbers.
 * Works directly on the {@code model} object of a cistem.io file.
 */
public final class Engine {

    public enum Status { ok, warn, crit }

    public record NodeResult(double load, double cap, double util, Status status, double lat, double cum) {}
    public record Verdict(Status status, String nodeId, double lat, boolean converged) {}
    public record Results(Map<String, NodeResult> nodes, Map<String, Double> edges, Verdict verdict) {}

    private Engine() {}

    static double num(JsonNode n, String f) { JsonNode v = n.get(f); return v == null || !v.isNumber() ? 0 : v.asDouble(); }
    static double clamp01(double v) { return Math.min(1, Math.max(0, v)); }
    static String kind(JsonNode n) { return n.path("kind").asText(""); }

    /** Sustainable requests/sec a node can take before it saturates. */
    public static double capacity(JsonNode n) {
        return switch (kind(n)) {
            case "lb" -> num(n, "maxRps");
            case "service" -> num(n, "rpsPerInstance") * num(n, "instances");
            case "cache" -> num(n, "maxOps");
            case "db" -> {
                double q = num(n, "maxQps"), r = Math.max(0, num(n, "replicas")), rs = clamp01(num(n, "readShare"));
                double perReq = Math.max((1 - rs) + rs / (1 + r), rs / (1 + r));
                yield perReq > 0 ? q / perReq : Double.POSITIVE_INFINITY;
            }
            case "queue" -> num(n, "maxThroughput");
            default -> Double.POSITIVE_INFINITY;
        };
    }

    /** Fraction of a node's incoming load that travels down each outgoing edge. */
    public static double outFactor(JsonNode n, int outCount) {
        return switch (kind(n)) {
            case "cache" -> 1 - clamp01(num(n, "hitRatio"));
            case "lb" -> outCount > 0 ? 1.0 / outCount : 1;
            default -> 1;
        };
    }

    /** M/M/1-style inflation: base / (1 - util), capped at 10x once saturated. */
    public static double effLatency(JsonNode n, double load) {
        double base = num(n, "latency"), cap = capacity(n);
        if (Double.isInfinite(cap) || cap <= 0) return base;
        double u = load / cap;
        if (u >= 0.999) return base * 10;
        return Math.min(base * 10, base / (1 - u));
    }

    public static Results compute(JsonNode model) {
        JsonNode nodes = model.path("nodes"), edges = model.path("edges");
        double target = num(model, "targetRps");
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        for (JsonNode n : nodes) byId.put(n.path("id").asText(), n);
        Map<String, Integer> outs = new HashMap<>();
        byId.keySet().forEach(id -> outs.put(id, 0));
        for (JsonNode e : edges) outs.computeIfPresent(e.path("from").asText(), (k, v) -> v + 1);

        Map<String, Double> load = new HashMap<>(), cum = new HashMap<>();
        byId.keySet().forEach(id -> { load.put(id, 0.0); cum.put(id, 0.0); });

        boolean converged = false;
        for (int iter = 0; iter < 60; iter++) {
            Map<String, Double> next = new HashMap<>(), ncum = new HashMap<>();
            for (var en : byId.entrySet()) { next.put(en.getKey(), "entry".equals(kind(en.getValue())) ? target : 0.0); ncum.put(en.getKey(), 0.0); }
            for (JsonNode e : edges) {
                String from = e.path("from").asText(), to = e.path("to").asText();
                JsonNode s = byId.get(from);
                if (s == null || !byId.containsKey(to)) continue;
                next.merge(to, load.get(from) * outFactor(s, outs.get(from)) * num(e, "calls"), Double::sum);
                ncum.merge(to, cum.get(from) + effLatency(s, load.get(from)), Math::max);
            }
            double delta = 0;
            for (String id : byId.keySet()) delta += Math.abs(next.get(id) - load.get(id));
            load.putAll(next); cum.putAll(ncum);
            if (delta < 0.01) { converged = true; break; }
        }

        Map<String, NodeResult> results = new LinkedHashMap<>();
        Status worst = Status.ok; String worstNode = null; double maxLat = 0;
        for (var en : byId.entrySet()) {
            String id = en.getKey(); JsonNode n = en.getValue();
            double cap = capacity(n), L = load.get(id);
            double util = Double.isInfinite(cap) ? 0 : cap > 0 ? L / cap : (L > 0 ? Double.POSITIVE_INFINITY : 0);
            Status status = util >= 1 ? Status.crit : util >= 0.7 ? Status.warn : Status.ok;
            double lat = effLatency(n, L);
            results.put(id, new NodeResult(L, cap, util, status, lat, cum.get(id) + lat));
            if (!"entry".equals(kind(n)) && cum.get(id) + lat > maxLat) maxLat = cum.get(id) + lat;
            if (status == Status.crit && worst != Status.crit) { worst = Status.crit; worstNode = id; }
            else if (status == Status.warn && worst == Status.ok) { worst = Status.warn; worstNode = id; }
        }
        Map<String, Double> edgeLoad = new LinkedHashMap<>();
        for (JsonNode e : edges) {
            String from = e.path("from").asText(); JsonNode s = byId.get(from);
            if (s != null) edgeLoad.put(e.path("id").asText(), load.get(from) * outFactor(s, outs.get(from)) * num(e, "calls"));
        }
        return new Results(results, edgeLoad, new Verdict(worst, worstNode, maxLat, converged));
    }

    /** Human-readable report for an agent: compact, every number rounded sensibly. */
    public static ObjectNode report(JsonNode file, Results r, tools.jackson.databind.ObjectMapper om) {
        ObjectNode out = om.createObjectNode();
        JsonNode model = file.path("model");
        Map<String, String> names = new HashMap<>();
        for (JsonNode n : model.path("nodes")) names.put(n.path("id").asText(), n.path("name").asText());
        out.put("targetRps", num(model, "targetRps"));
        out.put("verdict", switch (r.verdict().status()) { case ok -> "handles it"; case warn -> "near limit"; case crit -> "breaks"; });
        if (r.verdict().nodeId() != null) { out.put("bottleneck", names.get(r.verdict().nodeId())); out.put("bottleneckId", r.verdict().nodeId()); }
        out.put("p50PathLatencyMs", Math.round(r.verdict().lat()));
        out.put("converged", r.verdict().converged());
        var arr = out.putArray("components");
        for (var en : r.nodes().entrySet()) {
            NodeResult nr = en.getValue();
            ObjectNode c = arr.addObject();
            c.put("id", en.getKey()); c.put("name", names.get(en.getKey()));
            c.put("loadRps", Math.round(nr.load()));
            if (!Double.isInfinite(nr.cap())) { c.put("capacityRps", Math.round(nr.cap())); c.put("utilisationPct", Double.isInfinite(nr.util()) ? 9999 : Math.round(nr.util() * 100)); c.put("headroomRps", Math.round(Math.max(0, nr.cap() - nr.load()))); }
            c.put("status", nr.status().name());
            c.put("effectiveLatencyMs", Math.round(nr.lat() * 10) / 10.0);
        }
        return out;
    }
}
