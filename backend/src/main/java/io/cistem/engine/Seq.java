package io.cistem.engine;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sequence diagrams in cistem.io's text format — parse and print. Mirrors src/seq.ts (parseCistem /
 * printSeq); ParityTest runs both over the same cases.
 *
 * <pre>
 *   participant merchants, proxy
 *   participant ecom "ecom-transaction-payments" service @n3
 *   merchants -> proxy: POST /uploads        call
 *   proxy --> merchants: 202 Accepted        reply
 *   ecom ->> items: publish                  async
 *   note over a, b: text
 *   alt guard / else guard / end             also opt, loop, par (branches: and)
 * </pre>
 */
public final class Seq {
    private Seq() {}

    public record Error(int line, String message) {}
    public record Parsed(ObjectNode model, List<Error> errors) {}

    private static final Pattern ID = Pattern.compile("^[A-Za-z_$][\\w.$-]*$");
    private static final Pattern PARTICIPANT = Pattern.compile("^(participant|actor)\\s+(.+)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern PART_FULL = Pattern.compile("^([A-Za-z_$][\\w.$-]*)(?:\\s+\"([^\"]*)\")?(?:\\s+([A-Za-z][\\w-]*))?(?:\\s+@([\\w.$-]+))?\\s*$");
    private static final Pattern NOTE = Pattern.compile("^note\\s+(?:over|left of|right of)\\s+([^:]+?)\\s*(?::\\s*(.*))?$", Pattern.CASE_INSENSITIVE);
    private static final Pattern OPEN = Pattern.compile("^(alt|opt|loop|par)\\b\\s*(.*)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern BRANCH = Pattern.compile("^(else|and)\\b\\s*(.*)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern END = Pattern.compile("^end$", Pattern.CASE_INSENSITIVE);
    private static final Pattern MSG = Pattern.compile("^(\\S+?)\\s*(->>|-->|->)\\s*(\\S+?)\\s*(?::\\s*(.*))?$");

    public static Parsed parse(String text, ObjectMapper om) {
        ObjectNode model = om.createObjectNode();
        ArrayNode parts = model.putArray("participants"), rows = model.putArray("rows");
        List<Error> errors = new ArrayList<>();
        Deque<Object[]> stack = new ArrayDeque<>();   // {kind, line}
        int[] seq = {0};
        String[] lines = text.split("\n", -1);
        for (int line = 0; line < lines.length; line++) {
            String l = lines[line].trim();   // comments are whole lines only (labels may contain # and //)
            if (l.isEmpty() || l.startsWith("#") || l.startsWith("//")) continue;
            Matcher m;
            if ((m = PARTICIPANT.matcher(l)).matches()) {
                String rest = m.group(2).trim();
                boolean actor = m.group(1).equalsIgnoreCase("actor");
                if (!rest.contains("\"") && rest.contains(",")) {
                    for (String id : splitList(rest)) {
                        if (!ID.matcher(id).matches()) { errors.add(new Error(line, "\"" + id + "\" isn't a valid name: use letters, digits, - _ .")); continue; }
                        ensure(parts, id, id, actor ? "actor" : null);
                    }
                    continue;
                }
                Matcher pm = PART_FULL.matcher(rest);
                if (!pm.matches()) { errors.add(new Error(line, "Expected: participant id \"Name\" type @component")); continue; }
                String id = pm.group(1);
                if (has(parts, id)) { errors.add(new Error(line, "\"" + id + "\" is already declared")); continue; }
                ObjectNode p = parts.addObject();
                p.put("id", id).put("name", pm.group(2) != null ? pm.group(2) : id);
                String type = pm.group(3) != null ? pm.group(3) : actor ? "actor" : null;
                if (type != null) p.put("type", type);
                if (pm.group(4) != null) p.put("ref", pm.group(4));
                continue;
            }
            if ((m = NOTE.matcher(l)).matches()) {
                List<String> over = splitList(m.group(1));
                boolean ok = true;
                for (String id : over) if (!ID.matcher(id).matches()) { errors.add(new Error(line, "\"" + id + "\" isn't a participant name")); ok = false; break; }
                if (!ok) continue;
                over.forEach(id -> ensure(parts, id, id, null));
                ObjectNode r = rows.addObject(); r.put("t", "note").put("id", "r" + (++seq[0]));
                ArrayNode o = r.putArray("over"); over.forEach(o::add);
                r.put("text", m.group(2) == null ? "" : m.group(2).trim());
                continue;
            }
            if ((m = OPEN.matcher(l)).matches()) {
                String kind = m.group(1).toLowerCase(Locale.ROOT);
                stack.push(new Object[]{kind, line});
                rows.addObject().put("t", "open").put("id", "r" + (++seq[0])).put("kind", kind).put("guard", m.group(2).trim());
                continue;
            }
            if ((m = BRANCH.matcher(l)).matches()) {
                Object[] top = stack.peek();
                if (top == null) { errors.add(new Error(line, "\"else\" outside an alt or par block")); continue; }
                String k = (String) top[0];
                if (!k.equals("alt") && !k.equals("par")) { errors.add(new Error(line, "\"else\" only belongs in alt or par, not " + k)); continue; }
                rows.addObject().put("t", "else").put("id", "r" + (++seq[0])).put("guard", m.group(2).trim());
                continue;
            }
            if (END.matcher(l).matches()) {
                if (stack.isEmpty()) { errors.add(new Error(line, "\"end\" without a block to close")); continue; }
                stack.pop();
                rows.addObject().put("t", "close").put("id", "r" + (++seq[0]));
                continue;
            }
            if ((m = MSG.matcher(l)).matches()) {
                String from = m.group(1), arrow = m.group(2), to = m.group(3);
                if (!ID.matcher(from).matches() || !ID.matcher(to).matches()) {
                    String bad = !ID.matcher(from).matches() ? from : to;
                    errors.add(new Error(line, "\"" + bad + "\" isn't a valid name: use letters, digits, - _ ."));
                    continue;
                }
                ensure(parts, from, from, null); ensure(parts, to, to, null);
                rows.addObject().put("t", "msg").put("id", "r" + (++seq[0])).put("from", from).put("to", to)
                        .put("label", m.group(4) == null ? "" : m.group(4).trim())
                        .put("style", arrow.equals("->>") ? "async" : arrow.equals("-->") ? "reply" : "sync");
                continue;
            }
            errors.add(new Error(line, "Not understood. Try  a -> b: label,  note over a: text,  alt / else / end"));
        }
        while (!stack.isEmpty()) {
            Object[] s = stack.pop();
            errors.add(new Error((Integer) s[1], "\"" + s[0] + "\" is never closed with \"end\""));
            rows.addObject().put("t", "close").put("id", "r" + (++seq[0]));
        }
        errors.sort(Comparator.comparingInt(Error::line));
        return new Parsed(model, errors);
    }

    public static String print(JsonNode model) {
        List<String> out = new ArrayList<>();
        List<String> plain = new ArrayList<>();
        Runnable flush = () -> { if (!plain.isEmpty()) out.add("participant " + String.join(", ", plain)); plain.clear(); };
        for (JsonNode p : model.path("participants")) {
            String id = p.path("id").asText(), name = p.path("name").asText(id);
            boolean simple = name.equals(id) && !p.hasNonNull("type") && !p.hasNonNull("ref");
            if (simple) { plain.add(id); continue; }
            flush.run();
            StringBuilder b = new StringBuilder("participant ").append(id);
            if (!name.equals(id)) b.append(" \"").append(name.replace('"', '\'')).append('"');
            if (p.hasNonNull("type") && !p.path("type").asText().isEmpty()) b.append(' ').append(p.path("type").asText());
            if (p.hasNonNull("ref") && !p.path("ref").asText().isEmpty()) b.append(" @").append(p.path("ref").asText());
            out.add(b.toString());
        }
        flush.run();
        if (!model.path("rows").isEmpty() && !out.isEmpty()) out.add("");
        int depth = 0;
        Deque<String> kinds = new ArrayDeque<>();
        for (JsonNode r : model.path("rows")) {
            String t = r.path("t").asText();
            if (t.equals("close") || t.equals("else")) depth = Math.max(0, depth - 1);
            String ind = "  ".repeat(depth);
            switch (t) {
                case "msg" -> {
                    String style = r.path("style").asText("sync");
                    String arrow = style.equals("async") ? "->>" : style.equals("reply") ? "-->" : "->";
                    String label = r.path("label").asText("");
                    out.add(ind + r.path("from").asText() + " " + arrow + " " + r.path("to").asText() + (label.isEmpty() ? "" : ": " + label));
                }
                case "note" -> {
                    List<String> over = new ArrayList<>(); r.path("over").forEach(o -> over.add(o.asText()));
                    String text = r.path("text").asText("").replace("\n", " ");
                    out.add(ind + "note over " + String.join(", ", over) + (text.isEmpty() ? "" : ": " + text));
                }
                case "open" -> {
                    String g = r.path("guard").asText("");
                    out.add(ind + r.path("kind").asText() + (g.isEmpty() ? "" : " " + g));
                    kinds.push(r.path("kind").asText()); depth++;
                }
                case "else" -> {
                    String g = r.path("guard").asText("");
                    out.add(ind + ("par".equals(kinds.peek()) ? "and" : "else") + (g.isEmpty() ? "" : " " + g));
                    depth++;
                }
                default -> { out.add(ind + "end"); if (!kinds.isEmpty()) kinds.pop(); }
            }
        }
        return out.isEmpty() ? "" : String.join("\n", out) + "\n";
    }

    /** Keep row ids where the new rows line up with the old (same position, same kind), as the browser does. */
    public static void keepIds(JsonNode prev, ObjectNode next) {
        ArrayNode a = (ArrayNode) prev.path("rows"), b = (ArrayNode) next.path("rows");
        Set<String> taken = new HashSet<>();
        a.forEach(r -> taken.add(r.path("id").asText()));
        List<ObjectNode> fresh = new ArrayList<>();
        for (int i = 0; i < b.size(); i++) {
            JsonNode p = i < a.size() ? a.get(i) : null;
            ObjectNode r = (ObjectNode) b.get(i);
            if (p != null && p.path("t").asText().equals(r.path("t").asText())) r.put("id", p.path("id").asText());
            else fresh.add(r);
        }
        int k = 0;
        for (ObjectNode r : fresh) { String id; do id = "r" + (++k); while (taken.contains(id)); taken.add(id); r.put("id", id); }
        if (prev.has("uses") && !next.has("uses")) next.set("uses", prev.get("uses").deepCopy());
    }

    private static List<String> splitList(String s) {
        List<String> out = new ArrayList<>();
        for (String x : s.split(",")) { String t = x.trim(); if (!t.isEmpty()) out.add(t); }
        return out;
    }
    private static boolean has(ArrayNode parts, String id) {
        for (JsonNode p : parts) if (id.equals(p.path("id").asText())) return true;
        return false;
    }
    private static void ensure(ArrayNode parts, String id, String name, String type) {
        if (has(parts, id)) return;
        ObjectNode p = parts.addObject(); p.put("id", id).put("name", name);
        if (type != null) p.put("type", type);
    }
}
