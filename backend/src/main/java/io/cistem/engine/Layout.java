package io.cistem.engine;

import tools.jackson.databind.JsonNode;

import java.util.*;

/**
 * Layered left-to-right layout, container-aware. Port of src/layout.ts: each container is laid
 * out recursively into a block; at each level the blocks (nodes and child containers) are
 * arranged by longest path from the entry side with edges projected onto blocks.
 */
public final class Layout {

    public record Point(int x, int y) {}
    public record Frame(int x, int y, int w, int h) {}
    public record Result(Map<String, Point> positions, Map<String, Frame> frames) {}

    static final int COL_GAP = 120, ROW_GAP = 40, GROUP_GAP = 80, NODE_H = 92, ORIGIN_X = 40, ORIGIN_Y = 40;
    static final int FRAME_PAD = 28, FRAME_HEAD = 30;
    static final Map<String, Integer> WIDTHS = Map.of("entry", 190, "lb", 190, "service", 200, "cache", 190, "db", 200, "queue", 200);

    private Layout() {}

    // ---- mirrors of model.ts nodeHeight / nodeWidthFor / topicFields (expanded view sizes) ----
    static final int TABLE_HEAD = 22, ROW = 16, TABLE_PAD = 8, TABLE_GAP = 10, ENDPOINT_ROW = 18, TOPIC_HEAD = 20, TOPIC_ROW = 15, SECTION_PAD = 10, MAX_H = 560;

    public static int nodeHeight(JsonNode n, boolean expanded) {
        if (!expanded) return NODE_H;
        String kind = n.path("kind").asText();
        int extra = 0;
        if ("db".equals(kind)) { JsonNode ts = n.path("tables"); for (JsonNode t : ts) extra += TABLE_HEAD + t.path("columns").size() * ROW + TABLE_PAD; extra += Math.max(0, ts.size() - 1) * TABLE_GAP; }
        else if ("service".equals(kind)) extra = n.path("endpoints").size() * ENDPOINT_ROW;
        else if ("queue".equals(kind)) { JsonNode ts = n.path("topics"); for (JsonNode t : ts) extra += TOPIC_HEAD + topicFieldCount(t) * TOPIC_ROW; extra += Math.max(0, ts.size() - 1) * 6; }
        if (extra == 0) return NODE_H;
        return Math.min(MAX_H, NODE_H + SECTION_PAD + extra + SECTION_PAD);
    }

    public static int nodeWidthFor(JsonNode n, boolean expanded) {
        int w = nodeWidth(n);
        if (!expanded) return w;
        String kind = n.path("kind").asText();
        if ("db".equals(kind)) {
            int longest = 0;
            for (JsonNode t : n.path("tables")) for (JsonNode c : t.path("columns")) {
                int len = c.path("name").asText("").length() + c.path("type").asText("").length() + 3 + (c.path("references").isTextual() && !c.path("references").asText().isEmpty() ? 6 : 0);
                longest = Math.max(longest, len);
            }
            return (int) Math.min(360, Math.max(w, 40 + longest * 6.4 + 60));
        }
        if ("service".equals(kind) || "queue".equals(kind)) return Math.max(w, 280);
        return w;
    }

    static int topicFieldCount(JsonNode t) {
        try {
            JsonNode j = new tools.jackson.databind.ObjectMapper().readTree(t.path("schema").asText(""));
            return j != null && j.path("fields").isArray() ? j.path("fields").size() : 0;
        } catch (Exception e) { return 0; }
    }

    /** Mirror of model.ts nodeWidth: deterministic, no font metrics. */
    public static int nodeWidth(JsonNode n) {
        int base = WIDTHS.getOrDefault(n.path("kind").asText(), 200);
        double need = 56 + n.path("name").asText("").length() * 7.8 + 16;
        return Math.min(320, Math.max(base, (int) Math.round(need / 8) * 8));
    }

    public static Result layered(JsonNode model) { return layered(model, null); }

    /** `detail` is the file's layout.detail map (node id → compact | expanded); may be null. */
    public static Result layered(JsonNode model, JsonNode detail) {
        var ctx = new Ctx(model, detail);
        var root = ctx.level(null);
        ctx.shiftAll(ORIGIN_X - root[0], ORIGIN_Y - root[1]);
        return new Result(ctx.positions, ctx.frames);
    }

    private static final class Ctx {
        final JsonNode model;
        final Map<String, JsonNode> nodes = new LinkedHashMap<>(), containers = new LinkedHashMap<>();
        final Map<String, double[]> pos = new LinkedHashMap<>();      // node → [x,y]
        final Map<String, double[]> frm = new LinkedHashMap<>();      // container → [x,y,w,h]
        final Map<String, Point> positions = new LinkedHashMap<>();
        final Map<String, Frame> frames = new LinkedHashMap<>();
        final JsonNode detail;

        Ctx(JsonNode model, JsonNode detail) {
            this.model = model; this.detail = detail;
            for (JsonNode n : model.path("nodes")) nodes.put(n.path("id").asText(), n);
            for (JsonNode c : model.path("containers")) containers.put(c.path("id").asText(), c);
        }

        static String parentOf(JsonNode c) { JsonNode p = c.path("parent"); return p.isTextual() && !p.asText().isEmpty() ? p.asText() : null; }

        /** Returns {minX, minY, w, h} of this level in its local frame. */
        double[] level(String container) {
            List<String> children = containers.values().stream().filter(c -> Objects.equals(parentOf(c), container)).map(c -> c.path("id").asText()).toList();
            List<String> own = nodes.values().stream().filter(n -> Objects.equals(Engine.containerOf(n), container)).map(n -> n.path("id").asText()).toList();
            Map<String, double[]> blocks = new HashMap<>();
            for (String c : children) { double[] r = level(c); blocks.put(c, new double[]{ r[2], r[3] }); }

            List<String> itemIds = new ArrayList<>(own); itemIds.addAll(children);
            Map<String, double[]> size = new HashMap<>();
            for (String id : own) { boolean exp = detail != null && "expanded".equals(detail.path(id).asText("")); size.put(id, new double[]{ nodeWidthFor(nodes.get(id), exp), nodeHeight(nodes.get(id), exp) }); }
            for (String c : children) size.put(c, blocks.get(c));

            List<String[]> edges = new ArrayList<>();
            Set<String> itemSet = new HashSet<>(itemIds);
            for (JsonNode e : model.path("edges")) {
                String a = itemOf(e.path("from").asText(), container), b = itemOf(e.path("to").asText(), container);
                if (a != null && b != null && !a.equals(b) && itemSet.contains(a) && itemSet.contains(b)) edges.add(new String[]{ a, b });
            }
            List<String> roots = itemIds.stream().filter(id -> (nodes.containsKey(id) && "entry".equals(nodes.get(id).path("kind").asText())) || containsEntry(id)).toList();

            Map<String, double[]> placed = arrange(itemIds, size, edges, roots, container == null ? COL_GAP : COL_GAP / 2, container == null ? GROUP_GAP : ROW_GAP);

            double minX = Double.POSITIVE_INFINITY, minY = Double.POSITIVE_INFINITY, maxX = Double.NEGATIVE_INFINITY, maxY = Double.NEGATIVE_INFINITY;
            for (String id : itemIds) {
                double[] p = placed.get(id); double[] s = size.get(id);
                if (nodes.containsKey(id)) pos.put(id, new double[]{ snap(p[0]), snap(p[1]) });
                else shiftContainer(id, snap(p[0]), snap(p[1]), true);
                minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0] + s[0]); maxY = Math.max(maxY, p[1] + s[1]);
            }
            if (itemIds.isEmpty()) { minX = 0; minY = 0; maxX = 200; maxY = 80; }

            if (container != null) {
                double fx = minX - FRAME_PAD, fy = minY - FRAME_PAD - FRAME_HEAD, fw = maxX - minX + FRAME_PAD * 2, fh = maxY - minY + FRAME_PAD * 2 + FRAME_HEAD;
                shiftContainer(container, -fx, -fy, false);
                frm.put(container, new double[]{ 0, 0, fw, fh });
                return new double[]{ 0, 0, fw, fh };
            }
            return new double[]{ minX, minY, maxX - minX, maxY - minY };
        }

        String itemOf(String nodeId, String container) {
            JsonNode n = nodes.get(nodeId); if (n == null) return null;
            String c = Engine.containerOf(n);
            if (Objects.equals(c, container)) return nodeId;
            List<String> chain = Engine.ancestry(model, c);
            if (container == null) return chain.isEmpty() ? null : chain.get(chain.size() - 1);
            int i = chain.indexOf(container);
            return i > 0 ? chain.get(i - 1) : null;
        }

        boolean containsEntry(String containerId) {
            for (JsonNode n : nodes.values()) if ("entry".equals(n.path("kind").asText()) && Engine.ancestry(model, Engine.containerOf(n)).contains(containerId)) return true;
            return false;
        }

        void shiftContainer(String id, double dx, double dy, boolean moveFrame) {
            if (moveFrame && frm.containsKey(id)) { double[] f = frm.get(id); f[0] += dx; f[1] += dy; }
            for (JsonNode n : nodes.values()) if (Objects.equals(Engine.containerOf(n), id) && pos.containsKey(n.path("id").asText())) { double[] p = pos.get(n.path("id").asText()); p[0] += dx; p[1] += dy; }
            for (JsonNode c : containers.values()) if (Objects.equals(parentOf(c), id)) shiftContainer(c.path("id").asText(), dx, dy, true);
        }

        void shiftAll(double dx, double dy) {
            pos.forEach((id, p) -> positions.put(id, new Point((int) Math.round(p[0] + dx), (int) Math.round(p[1] + dy))));
            frm.forEach((id, f) -> frames.put(id, new Frame((int) Math.round(f[0] + dx), (int) Math.round(f[1] + dy), (int) Math.round(f[2]), (int) Math.round(f[3]))));
        }
    }

    private static Map<String, double[]> arrange(List<String> ids, Map<String, double[]> size, List<String[]> edgeList, List<String> roots, int colGap, int rowGap) {
        Map<String, List<String>> out = new HashMap<>(), inn = new HashMap<>();
        ids.forEach(id -> { out.put(id, new ArrayList<>()); inn.put(id, new ArrayList<>()); });
        for (String[] e : edgeList) if (!out.get(e[0]).contains(e[1])) { out.get(e[0]).add(e[1]); inn.get(e[1]).add(e[0]); }

        Map<String, Integer> state = new HashMap<>(); Set<String> back = new HashSet<>();
        List<String> order0 = new ArrayList<>(roots); ids.forEach(id -> { if (!order0.contains(id)) order0.add(id); });
        for (String id : order0) if (!state.containsKey(id)) dfs(id, out, state, back);
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

        double[] colW = new double[cols.size()], colH = new double[cols.size()];
        for (int i = 0; i < cols.size(); i++) {
            var c = cols.get(i);
            colW[i] = c.stream().mapToDouble(id -> size.get(id)[0]).max().orElse(0);
            colH[i] = c.stream().mapToDouble(id -> size.get(id)[1]).sum() + Math.max(0, c.size() - 1) * rowGap;
        }
        double totalH = Arrays.stream(colH).max().orElse(0);
        Map<String, double[]> result = new LinkedHashMap<>();
        double x = 0;
        for (int i = 0; i < cols.size(); i++) {
            double y = (totalH - colH[i]) / 2.0;
            for (String id : cols.get(i)) { result.put(id, new double[]{ x, y }); y += size.get(id)[1] + rowGap; }
            x += colW[i] + colGap;
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

    private static double snap(double v) { return Math.round(v / 8) * 8; }
}
