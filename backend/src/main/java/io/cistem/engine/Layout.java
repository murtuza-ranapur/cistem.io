package io.cistem.engine;

import tools.jackson.databind.JsonNode;

import java.util.*;

/** Layered left-to-right layout. Port of src/layout.ts (same constants, same ordering rules). */
public final class Layout {

    public record Point(int x, int y) {}

    static final int COL_GAP = 120, ROW_GAP = 40, NODE_H = 92, ORIGIN_X = 40, ORIGIN_Y = 40;
    static final Map<String, Integer> WIDTHS = Map.of("entry", 190, "lb", 190, "service", 200, "cache", 190, "db", 200, "queue", 200);

    private Layout() {}

    public static Map<String, Point> layered(JsonNode model) {
        List<String> ids = new ArrayList<>();
        Map<String, JsonNode> byId = new LinkedHashMap<>();
        for (JsonNode n : model.path("nodes")) { String id = n.path("id").asText(); ids.add(id); byId.put(id, n); }
        Map<String, List<String>> out = new HashMap<>(), inn = new HashMap<>();
        ids.forEach(id -> { out.put(id, new ArrayList<>()); inn.put(id, new ArrayList<>()); });
        for (JsonNode e : model.path("edges")) {
            String f = e.path("from").asText(), t = e.path("to").asText();
            if (!byId.containsKey(f) || !byId.containsKey(t) || f.equals(t)) continue;
            if (!out.get(f).contains(t)) { out.get(f).add(t); inn.get(t).add(f); }
        }
        // back-edges via DFS
        Map<String, Integer> state = new HashMap<>();
        Set<String> back = new HashSet<>();
        List<String> roots = ids.stream().filter(id -> "entry".equals(byId.get(id).path("kind").asText())).toList();
        List<String> order = new ArrayList<>(roots); ids.forEach(id -> { if (!order.contains(id)) order.add(id); });
        for (String id : order) if (!state.containsKey(id)) dfs(id, out, state, back);
        java.util.function.Function<String, List<String>> fwd = u -> out.get(u).stream().filter(v -> !back.contains(u + ">" + v)).toList();
        java.util.function.Function<String, List<String>> preds = v -> inn.get(v).stream().filter(u -> !back.contains(u + ">" + v)).toList();

        Map<String, Integer> layer = new HashMap<>();
        List<String> topo = topo(ids, fwd);
        for (String u : topo) { var ps = preds.apply(u); layer.put(u, ps.isEmpty() ? 0 : ps.stream().mapToInt(layer::get).max().orElse(-1) + 1); }
        if (!roots.isEmpty()) {
            for (String id : ids) if (layer.get(id) == 0 && !roots.contains(id)) layer.put(id, 1);
            for (String u : topo) { var ps = preds.apply(u); if (!ps.isEmpty()) layer.put(u, Math.max(layer.get(u), ps.stream().mapToInt(p -> layer.get(p) + 1).max().orElse(0))); }
        }
        int maxLayer = layer.values().stream().mapToInt(i -> i).max().orElse(0);
        List<List<String>> cols = new ArrayList<>();
        for (int i = 0; i <= maxLayer; i++) cols.add(new ArrayList<>());
        for (String id : ids) cols.get(layer.get(id)).add(id);

        Map<String, Integer> pos = new HashMap<>();
        for (var c : cols) for (int i = 0; i < c.size(); i++) pos.put(c.get(i), i);
        sweep(cols, pos, preds, true); sweep(cols, pos, fwd, false); sweep(cols, pos, preds, true);

        int[] colW = new int[cols.size()], colH = new int[cols.size()];
        for (int i = 0; i < cols.size(); i++) {
            var c = cols.get(i);
            colW[i] = c.stream().mapToInt(id -> WIDTHS.getOrDefault(byId.get(id).path("kind").asText(), 200)).max().orElse(0);
            colH[i] = c.size() * NODE_H + Math.max(0, c.size() - 1) * ROW_GAP;
        }
        int totalH = Arrays.stream(colH).max().orElse(0);
        Map<String, Point> result = new LinkedHashMap<>();
        double x = ORIGIN_X;
        for (int i = 0; i < cols.size(); i++) {
            double y = ORIGIN_Y + (totalH - colH[i]) / 2.0;
            for (String id : cols.get(i)) { result.put(id, new Point(snap(x), snap(y))); y += NODE_H + ROW_GAP; }
            x += colW[i] + COL_GAP;
        }
        return result;
    }

    private static void dfs(String u, Map<String, List<String>> out, Map<String, Integer> state, Set<String> back) {
        state.put(u, 1);
        for (String v : out.get(u)) {
            if (Integer.valueOf(1).equals(state.get(v))) back.add(u + ">" + v);
            else if (!state.containsKey(v)) dfs(v, out, state, back);
        }
        state.put(u, 2);
    }

    private static List<String> topo(List<String> ids, java.util.function.Function<String, List<String>> fwd) {
        Map<String, Integer> indeg = new HashMap<>();
        ids.forEach(id -> indeg.put(id, 0));
        ids.forEach(u -> fwd.apply(u).forEach(v -> indeg.merge(v, 1, Integer::sum)));
        Deque<String> q = new ArrayDeque<>(ids.stream().filter(id -> indeg.get(id) == 0).toList());
        List<String> out = new ArrayList<>();
        while (!q.isEmpty()) { String u = q.poll(); out.add(u); for (String v : fwd.apply(u)) if (indeg.merge(v, -1, Integer::sum) == 0) q.add(v); }
        ids.forEach(id -> { if (!out.contains(id)) out.add(id); });
        return out;
    }

    private static void sweep(List<List<String>> cols, Map<String, Integer> pos, java.util.function.Function<String, List<String>> nb, boolean down) {
        List<Integer> range = new ArrayList<>(); for (int i = 0; i < cols.size(); i++) range.add(i);
        if (!down) Collections.reverse(range);
        for (int li : range) {
            var c = cols.get(li);
            Map<String, Double> bary = new HashMap<>();
            for (String id : c) { var ns = nb.apply(id); bary.put(id, ns.isEmpty() ? pos.get(id) : ns.stream().mapToDouble(pos::get).sum() / ns.size()); }
            c.sort((a, b) -> { int cmp = Double.compare(bary.get(a), bary.get(b)); return cmp != 0 ? cmp : Integer.compare(pos.get(a), pos.get(b)); });
            for (int i = 0; i < c.size(); i++) pos.put(c.get(i), i);
        }
    }

    private static int snap(double v) { return (int) Math.round(v / 8) * 8; }
}
