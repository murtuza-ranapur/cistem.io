package io.cistem.engine;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;

/**
 * Capacity model. Port of src/engine.ts; test/resources/parity.json pins both to the same numbers.
 * Works directly on the {@code model} object of a cistem.dev file.
 */
public final class Engine {

    public enum Status { ok, warn, crit }

    /** idle: a consumer's instances beyond the partitions it reads (0 when none). */
    public record NodeResult(double load, double cap, double util, Status status, double lat, double cum, double idle,
                             /* mirror of engine.ts: pull consumer, its lag (msg/s), hours until its backlog expires (-1: unknown), cum is after publish */
                             boolean pull, double lag, double lossAfter, boolean async) {}
    public record Verdict(Status status, String nodeId, double lat, double asyncLat, boolean converged) {}
    public record Results(Map<String, NodeResult> nodes, Map<String, Double> edges, Map<String, Double> crossings, Verdict verdict) {}

    // ---- containers / crossing latency (port of model.ts crossingLatency) ----
    static final double SIBLINGS_MS = 1, DIFFERENT_ROOTS_MS = 10;

    public static List<String> ancestry(JsonNode model, String containerId) {
        List<String> out = new ArrayList<>();
        Map<String, JsonNode> byId = new HashMap<>();
        for (JsonNode c : model.path("containers")) byId.put(c.path("id").asText(), c);
        String cur = containerId; int guard = 0;
        while (cur != null && !cur.isEmpty() && guard++ < 32) {
            out.add(cur);
            JsonNode c = byId.get(cur);
            cur = c == null || c.path("parent").isNull() || c.path("parent").isMissingNode() ? null : c.path("parent").asText();
        }
        return out;
    }

    public static String containerOf(JsonNode n) {
        JsonNode c = n.path("container");
        return c.isTextual() && !c.asText().isEmpty() ? c.asText() : null;
    }

    public static double crossingLatency(JsonNode model, String a, String b) {
        if (Objects.equals(a, b)) return 0;
        List<String> pa = ancestry(model, a), pb = ancestry(model, b);
        List<String> xa = pa.isEmpty() ? List.of("") : pa, xb = pb.isEmpty() ? List.of("") : pb;
        for (String x : xa) for (String y : xb)
            for (JsonNode l : model.path("links")) {
                String f = l.path("from").asText(), t = l.path("to").asText();
                if ((f.equals(x) && t.equals(y)) || (f.equals(y) && t.equals(x))) return num(l, "latencyMs");
            }
        if (a == null || b == null) return SIBLINGS_MS;
        return pa.get(pa.size() - 1).equals(pb.get(pb.size() - 1)) ? SIBLINGS_MS : DIFFERENT_ROOTS_MS;
    }

    /** Loads are capped so absurd inputs (1e300 × 1e300) stay finite numbers instead of Infinity/NaN; mirrors engine.ts. */
    static final double MAX_LOAD = 1e18;

    private Engine() {}

    /** Non-negative finite number, or 0. Numeric strings count; anything else reads as 0 (mirrors num in engine.ts). */
    static double num(JsonNode n, String f) {
        JsonNode v = n.get(f);
        double x;
        if (v == null) return 0;
        if (v.isNumber()) x = v.asDouble();
        else if (v.isString() && !v.asString().isBlank()) { try { x = Double.parseDouble(v.asString().trim()); } catch (NumberFormatException e) { return 0; } }
        else return 0;
        return Double.isFinite(x) && x > 0 ? x : 0;
    }
    /** Mirror of model.ts edgeCalls: the sum over the endpoints a connection lists, else its calls. */
    static double edgeCalls(JsonNode e) {
        JsonNode eps = e.path("endpoints");
        if (eps.isArray() && !eps.isEmpty()) { double s = 0; for (JsonNode x : eps) s += num(x, "calls"); return s; }
        return num(e, "calls");
    }
    static double clamp01(double v) { return Math.min(1, Math.max(0, v)); }
    static String kind(JsonNode n) { return n.path("kind").asText(""); }

    /** Sustainable requests/sec a node can take before it saturates. */
    public static double capacity(JsonNode n) { return capacity(n, 0); }
    public static double capacity(JsonNode n, double partitionsIn) {
        return switch (Types.behaviour(n)) {   // by behaviour (shared/component-types.json), never by type name
            case "balancer", "limit" -> num(n, "maxRps");
            // a consumer group uses one instance per partition at most
            case "scaled" -> num(n, "rpsPerInstance") * (partitionsIn > 0 ? Math.min(num(n, "instances"), partitionsIn) : num(n, "instances"));
            case "cache" -> num(n, "maxOps");
            case "store" -> {
                double q = num(n, "maxQps"), r = Math.max(0, num(n, "replicas")), rs = clamp01(num(n, "readShare"));
                double perReq = Math.max((1 - rs) + rs / (1 + r), rs / (1 + r));
                yield perReq > 0 ? q / perReq : Double.POSITIVE_INFINITY;
            }
            case "async" -> n.has("msgPerPartition") ? num(n, "partitions") * num(n, "msgPerPartition") : num(n, "maxThroughput");
            default -> Double.POSITIVE_INFINITY;
        };
    }

    /** Fraction of a node's incoming load that travels down each outgoing edge. */
    public static double outFactor(JsonNode n, int outCount) {
        return switch (Types.behaviour(n)) {
            case "cache" -> 1 - clamp01(num(n, "hitRatio"));
            case "balancer" -> outCount > 0 ? 1.0 / outCount : 1;
            default -> 1;
        };
    }

    /** M/M/1-style inflation: base / (1 - util), capped at 10x once saturated. */
    public static double effLatency(JsonNode n, double load) { return effLatency(n, load, capacity(n)); }
    public static double effLatency(JsonNode n, double load, double cap) {
        double base = num(n, "latency");
        if (Double.isInfinite(cap) || cap <= 0) return base;
        double u = load / cap;
        if (u >= 0.999) return base * 10;
        return Math.min(base * 10, base / (1 - u));
    }

    /** Mirror of engine.ts isConsumer: fed only by topics or queues, so it pulls at its own pace. */
    static boolean isConsumer(JsonNode model, JsonNode n, Map<String, JsonNode> byId) {
        if (Types.isSource(n) || Types.isAsync(n)) return false;
        String id = n.path("id").asText(); boolean any = false;
        for (JsonNode e : model.path("edges")) {
            if (!e.path("to").asText().equals(id)) continue;
            JsonNode s = byId.get(e.path("from").asText());
            if (s == null) continue;
            if (!Types.isAsync(s)) return false;
            any = true;
        }
        return any;
    }

    /** A partitioned topic: its consumers can't use more instances than it has partitions. */
    static boolean partitioned(JsonNode n) { return Types.isAsync(n) && n.has("msgPerPartition") && num(n, "partitions") > 0; }

    /** Mirror of engine.ts partitionsIn: partitions a pure consumer reads, summed over its topics; 0 = no cap. */
    static Map<String, Double> partitionsIn(JsonNode model, Map<String, JsonNode> byId) {
        Map<String, Double> out = new HashMap<>();
        byId.forEach((id, n) -> {
            if (!"scaled".equals(Types.behaviour(n))) { out.put(id, 0.0); return; }
            java.util.List<JsonNode> from = new java.util.ArrayList<>();
            for (JsonNode e : model.path("edges")) if (e.path("to").asText().equals(id) && byId.containsKey(e.path("from").asText())) from.add(byId.get(e.path("from").asText()));
            boolean all = !from.isEmpty() && from.stream().allMatch(Engine::partitioned);
            java.util.Set<String> seen = new java.util.HashSet<>(); double sum = 0;
            if (all) for (JsonNode s : from) if (seen.add(s.path("id").asText())) sum += num(s, "partitions");
            out.put(id, all ? sum : 0.0);
        });
        return out;
    }

    public static Results compute(JsonNode model) {
        JsonNode nodes = model.path("nodes"), edges = model.path("edges");
        // v4: each Clients node carries its own peak rps; a v3 model's diagram-wide target still works as a fallback
        double legacyTarget = model.has("targetRps") ? num(model, "targetRps") : 0;
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        for (JsonNode n : nodes) byId.put(n.path("id").asText(), n);
        Map<String, Integer> outs = new HashMap<>();
        byId.keySet().forEach(id -> outs.put(id, 0));
        for (JsonNode e : edges) outs.computeIfPresent(e.path("from").asText(), (k, v) -> v + 1);
        Map<String, Double> pin = partitionsIn(model, byId), caps = new HashMap<>();
        Map<String, Boolean> pull = new HashMap<>();
        byId.forEach((id, n) -> { caps.put(id, capacity(n, pin.get(id))); pull.put(id, isConsumer(model, n, byId)); });
        // a consumer passes on only what it gets through, and doesn't queue inside (the backlog is in the topic)
        java.util.function.BiFunction<String, Double, Double> through = (id, L) -> pull.get(id) && L > caps.get(id) ? (L > 0 ? caps.get(id) / L : 0) : 1.0;
        java.util.function.BiFunction<JsonNode, Double, Double> latOf = (n, L) -> pull.get(n.path("id").asText()) ? num(n, "latency") : effLatency(n, L, caps.get(n.path("id").asText()));

        // Load per node broken down by origin: "sync" or the queue it was consumed from.
        // Load consumed from queue Q is never published back into Q (a service may consume its own topic).
        Map<String, Map<String, Double>> bd = new HashMap<>();
        // time along the request (cum) and, through a topic, since the publish (acum; -1 = not reached that way)
        Map<String, Double> cum = new HashMap<>(), acum = new HashMap<>();
        byId.keySet().forEach(id -> { bd.put(id, new HashMap<>()); cum.put(id, 0.0); acum.put(id, -1.0); });
        java.util.function.Function<String, Double> total = id -> bd.get(id).values().stream().mapToDouble(Double::doubleValue).sum();
        java.util.function.Function<String, Double> syncOf = id -> bd.get(id).getOrDefault("sync", 0.0);

        boolean converged = false;
        for (int iter = 0; iter < 60; iter++) {
            Map<String, Map<String, Double>> next = new HashMap<>(); Map<String, Double> ncum = new HashMap<>(), nacum = new HashMap<>();
            for (var en : byId.entrySet()) {
                Map<String, Double> m = new HashMap<>();
                if (Types.isSource(en.getValue())) m.put("sync", Math.min(MAX_LOAD, en.getValue().has("rps") ? num(en.getValue(), "rps") : legacyTarget));
                next.put(en.getKey(), m); ncum.put(en.getKey(), 0.0); nacum.put(en.getKey(), -1.0);
            }
            for (JsonNode e : edges) {
                String from = e.path("from").asText(), to = e.path("to").asText();
                JsonNode s = byId.get(from), t = byId.get(to);
                if (s == null || t == null) continue;
                double srcTotal = total.apply(from);
                double factor = outFactor(s, outs.get(from)) * edgeCalls(e) * through.apply(from, srcTotal);
                boolean toQueue = Types.isAsync(t), fromQueue = Types.isAsync(s);
                for (var o : bd.get(from).entrySet()) {
                    if (toQueue && o.getKey().equals(to)) continue;
                    String tag = fromQueue ? from : o.getKey();
                    next.get(to).merge(tag, Math.min(MAX_LOAD, o.getValue() * factor), (x, y) -> Math.min(MAX_LOAD, x + y));
                }
                double step = latOf.apply(s, srcTotal) + crossingLatency(model, containerOf(s), containerOf(t));
                if (fromQueue) {
                    if (srcTotal > 0) nacum.merge(to, Math.max(0, acum.get(from)) + step, Math::max);
                } else {
                    if (Types.isSource(s) || syncOf.apply(from) > 0) ncum.merge(to, cum.get(from) + step, Math::max);
                    if (acum.get(from) >= 0 && srcTotal - syncOf.apply(from) > 0) nacum.merge(to, acum.get(from) + step, Math::max);
                }
            }
            double delta = 0;
            for (String id : byId.keySet()) delta += Math.abs(next.get(id).values().stream().mapToDouble(Double::doubleValue).sum() - total.apply(id));
            bd.putAll(next); cum.putAll(ncum); acum.putAll(nacum);
            if (delta < 0.01) { converged = true; break; }
        }
        Map<String, Double> load = new HashMap<>();
        byId.keySet().forEach(id -> load.put(id, total.apply(id)));

        Map<String, NodeResult> results = new LinkedHashMap<>();
        Status worst = Status.ok; String worstNode = null; double maxLat = 0, asyncLat = 0;
        for (var en : byId.entrySet()) {
            String id = en.getKey(); JsonNode n = en.getValue();
            double cap = caps.get(id), L = load.get(id);
            double util = Double.isInfinite(cap) ? 0 : cap > 0 ? L / cap : (L > 0 ? Double.POSITIVE_INFINITY : 0);
            boolean p = pull.get(id);
            // a consumer that can't keep up falls behind (lag); it doesn't fail
            Status status = util >= 1 ? (p ? Status.warn : Status.crit) : util >= 0.7 ? Status.warn : Status.ok;
            double lat = latOf.apply(n, L);
            double idle = pin.get(id) > 0 && num(n, "instances") > pin.get(id) ? num(n, "instances") - pin.get(id) : 0;
            boolean viaSync = Types.isSource(n) || syncOf.apply(id) > 0, viaAsync = acum.get(id) >= 0 && L - syncOf.apply(id) > 0;
            double lag = p && L > cap ? L - cap : 0, lossAfter = -1;
            if (lag > 0) {
                double r = Double.POSITIVE_INFINITY;
                for (JsonNode e : edges) {
                    if (!e.path("to").asText().equals(id)) continue;
                    JsonNode s = byId.get(e.path("from").asText());
                    if (s != null && Types.isAsync(s) && num(s, "retentionHours") > 0) r = Math.min(r, num(s, "retentionHours"));
                }
                if (!Double.isInfinite(r)) lossAfter = r / (1 - cap / L);
            }
            results.put(id, new NodeResult(L, cap, util, status, lat, ((viaSync || !viaAsync) ? cum.get(id) : acum.get(id)) + lat, idle, p, lag, lossAfter, !viaSync && viaAsync));
            if (!Types.isSource(n) && L > 0 && viaSync && cum.get(id) + lat > maxLat) maxLat = cum.get(id) + lat;   // only what traffic reaches
            if (viaAsync && acum.get(id) + lat > asyncLat) asyncLat = acum.get(id) + lat;
            if (status == Status.crit && worst != Status.crit) { worst = Status.crit; worstNode = id; }
            // among the amber ones, a consumer falling behind says more than one near its limit
            else if (status == Status.warn && (worst == Status.ok || (worst == Status.warn && lag > 0 && !(worstNode != null && results.get(worstNode).lag() > 0)))) { worst = Status.warn; worstNode = id; }
        }
        Map<String, Double> edgeLoad = new LinkedHashMap<>(), crossings = new LinkedHashMap<>();
        for (JsonNode e : edges) {
            String from = e.path("from").asText(), to = e.path("to").asText(); JsonNode s = byId.get(from), t = byId.get(to);
            if (s == null || t == null) continue;
            boolean toQueue = Types.isAsync(t);
            double eligible = bd.get(from).entrySet().stream().filter(o -> !(toQueue && o.getKey().equals(to))).mapToDouble(Map.Entry::getValue).sum();
            edgeLoad.put(e.path("id").asText(), eligible * outFactor(s, outs.get(from)) * edgeCalls(e) * through.apply(from, total.apply(from)));
            crossings.put(e.path("id").asText(), crossingLatency(model, containerOf(s), containerOf(t)));
        }
        return new Results(results, edgeLoad, crossings, new Verdict(worst, worstNode, maxLat, asyncLat, converged));
    }

    /** Human-readable report for an agent: compact, every number rounded sensibly. */
    public static ObjectNode report(JsonNode file, Results r, tools.jackson.databind.ObjectMapper om) {
        ObjectNode out = om.createObjectNode();
        JsonNode model = file.path("model");
        Map<String, String> names = new HashMap<>(), cnames = new HashMap<>(), nodeContainer = new HashMap<>();
        for (JsonNode c : model.path("containers")) cnames.put(c.path("id").asText(), c.path("name").asText());
        for (JsonNode n : model.path("nodes")) { names.put(n.path("id").asText(), n.path("name").asText()); if (containerOf(n) != null) nodeContainer.put(n.path("id").asText(), cnames.getOrDefault(containerOf(n), containerOf(n))); }
        double total = 0; for (JsonNode n : model.path("nodes")) if (Types.isSource(n)) total += n.has("rps") ? num(n, "rps") : num(model, "targetRps");
        out.put("totalRps", total);
        boolean behind = r.verdict().nodeId() != null && r.nodes().get(r.verdict().nodeId()).lag() > 0;
        out.put("verdict", behind ? "falls behind" : switch (r.verdict().status()) { case ok -> "handles it"; case warn -> "near limit"; case crit -> "breaks"; });
        if (r.verdict().nodeId() != null) { out.put("bottleneck", names.get(r.verdict().nodeId())); out.put("bottleneckId", r.verdict().nodeId()); }
        out.put("p50PathLatencyMs", Math.round(r.verdict().lat()));
        if (r.verdict().asyncLat() > 0) out.put("asyncPathLatencyMs", Math.round(r.verdict().asyncLat()));   // after a publish, plus any lag
        out.put("converged", r.verdict().converged());
        var arr = out.putArray("components");
        for (var en : r.nodes().entrySet()) {
            NodeResult nr = en.getValue();
            ObjectNode c = arr.addObject();
            c.put("id", en.getKey()); c.put("name", names.get(en.getKey()));
            if (nodeContainer.containsKey(en.getKey())) c.put("in", nodeContainer.get(en.getKey()));
            c.put("loadRps", Math.round(nr.load()));
            if (!Double.isInfinite(nr.cap())) { c.put("capacityRps", Math.round(nr.cap())); c.put("utilisationPct", Double.isInfinite(nr.util()) ? 9999 : Math.round(nr.util() * 100)); c.put("headroomRps", Math.round(Math.max(0, nr.cap() - nr.load()))); }
            c.put("status", nr.status().name());
            c.put("effectiveLatencyMs", Math.round(nr.lat() * 10) / 10.0);
            if (nr.idle() > 0) c.put("idleInstances", Math.round(nr.idle()));
            if (nr.pull()) c.put("pullsFromTopics", true);
            if (nr.lag() > 0) c.put("lagGrowsMsgPerSec", Math.round(nr.lag()));
            if (nr.lossAfter() >= 0) c.put("backlogExpiresAfterHours", Math.round(nr.lossAfter() * 10) / 10.0);
        }
        var cross = out.putArray("boundaryCrossings");
        for (JsonNode e : model.path("edges")) {
            Double ms = r.crossings().get(e.path("id").asText());
            if (ms == null || ms == 0) continue;
            ObjectNode x = cross.addObject();
            x.put("edgeId", e.path("id").asText());
            x.put("from", names.get(e.path("from").asText())); x.put("to", names.get(e.path("to").asText()));
            x.put("addedLatencyMs", ms);
            x.put("callsPerSec", Math.round(r.edges().getOrDefault(e.path("id").asText(), 0.0)));
        }
        return out;
    }
}
