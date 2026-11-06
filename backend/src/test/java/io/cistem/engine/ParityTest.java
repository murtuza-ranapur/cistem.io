package io.cistem.engine;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.InputStream;

import static org.junit.jupiter.api.Assertions.*;

/** The Java engine and layout must produce exactly what src/engine.ts and src/layout.ts produce. */
class ParityTest {

    static JsonNode fixture() throws Exception {
        try (InputStream in = ParityTest.class.getResourceAsStream("/parity.json")) {
            return new ObjectMapper().readTree(in);
        }
    }

    @Test
    void engineMatchesTypeScript() throws Exception {
        JsonNode f = fixture();
        Engine.Results r = Engine.compute(f.path("file").path("model"));
        JsonNode exp = f.path("expected");

        for (var it = exp.path("nodes").properties().iterator(); it.hasNext(); ) {
            var en = it.next();
            Engine.NodeResult got = r.nodes().get(en.getKey());
            JsonNode e = en.getValue();
            assertNotNull(got, en.getKey());
            assertEquals(e.path("load").asDouble(), got.load(), 1e-6, en.getKey() + " load");
            if (e.path("cap").isNull()) assertTrue(Double.isInfinite(got.cap()), en.getKey() + " cap");
            else assertEquals(e.path("cap").asDouble(), got.cap(), 1e-6, en.getKey() + " cap");
            if (!e.path("util").isNull()) assertEquals(e.path("util").asDouble(), got.util(), 1e-9, en.getKey() + " util");
            assertEquals(e.path("status").asText(), got.status().name(), en.getKey() + " status");
            assertEquals(e.path("lat").asDouble(), got.lat(), 1e-6, en.getKey() + " lat");
            assertEquals(e.path("cum").asDouble(), got.cum(), 1e-6, en.getKey() + " cum");
        }
        for (var it = exp.path("edges").properties().iterator(); it.hasNext(); ) {
            var en = it.next();
            assertEquals(en.getValue().asDouble(), r.edges().get(en.getKey()), 1e-6, "edge " + en.getKey());
        }
        for (var it = exp.path("crossings").properties().iterator(); it.hasNext(); ) {
            var en = it.next();
            assertEquals(en.getValue().asDouble(), r.crossings().get(en.getKey()), 1e-9, "crossing " + en.getKey());
        }
        JsonNode v = exp.path("verdict");
        assertEquals(v.path("status").asText(), r.verdict().status().name());
        assertEquals(v.path("node").asText(), r.verdict().nodeId());
        assertEquals(v.path("lat").asDouble(), r.verdict().lat(), 1e-6);
        assertEquals(v.path("converged").asBoolean(), r.verdict().converged());
    }

    @Test
    void layoutMatchesTypeScript() throws Exception {
        JsonNode f = fixture();
        var got = Layout.layered(f.path("file").path("model"));
        JsonNode exp = f.path("expected").path("layout");
        assertEquals(exp.size(), got.positions().size());
        for (var it = exp.properties().iterator(); it.hasNext(); ) {
            var en = it.next();
            Layout.Point p = got.positions().get(en.getKey());
            assertEquals(en.getValue().path("x").asInt(), p.x(), en.getKey() + " x");
            assertEquals(en.getValue().path("y").asInt(), p.y(), en.getKey() + " y");
        }
        JsonNode fr = f.path("expected").path("frames");
        assertEquals(fr.size(), got.frames().size());
        for (var it = fr.properties().iterator(); it.hasNext(); ) {
            var en = it.next();
            Layout.Frame g = got.frames().get(en.getKey());
            assertNotNull(g, en.getKey());
            assertEquals(en.getValue().path("x").asInt(), g.x(), en.getKey() + " fx");
            assertEquals(en.getValue().path("y").asInt(), g.y(), en.getKey() + " fy");
            assertEquals(en.getValue().path("w").asInt(), g.w(), en.getKey() + " fw");
            assertEquals(en.getValue().path("h").asInt(), g.h(), en.getKey() + " fh");
        }
    }
}
