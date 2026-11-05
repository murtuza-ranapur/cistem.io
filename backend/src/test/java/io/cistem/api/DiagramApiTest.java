package io.cistem.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Runs against the DATABASE_URL in the environment (CI and local dev both provide one). */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "cistem.api-key=test-key")
class DiagramApiTest {

    @Autowired MockMvc mvc;

    static final String DOC = """
            {"document":{"version":2,"kind":"system","meta":{"title":"Test system","created":"2026-01-01T00:00:00Z","updated":"2026-01-01T00:00:00Z"},
             "model":{"targetRps":1000,"nodes":[],"edges":[]},"layout":{"positions":{}}}}""";

    @Test
    void rejectsMissingKey() throws Exception {
        mvc.perform(get("/api/diagrams")).andExpect(status().isUnauthorized());
    }

    @Test
    void crudWithOptimisticConcurrency() throws Exception {
        var created = mvc.perform(post("/api/diagrams").header("X-Api-Key", "test-key").contentType(MediaType.APPLICATION_JSON).content(DOC))
                .andExpect(status().isCreated())
                .andExpect(header().string("ETag", "\"1\""))
                .andExpect(jsonPath("$.title").value("Test system"))
                .andExpect(jsonPath("$.kind").value("system"))
                .andReturn();
        String id = com.jayway.jsonpath.JsonPath.read(created.getResponse().getContentAsString(), "$.id");

        mvc.perform(get("/api/diagrams").header("X-Api-Key", "test-key"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].title", contains("Test system")))
                .andExpect(jsonPath("$[0].document").doesNotExist());

        // matching version → 200, version bumps
        mvc.perform(put("/api/diagrams/" + id).header("X-Api-Key", "test-key").header("If-Match", "\"1\"")
                        .contentType(MediaType.APPLICATION_JSON).content(DOC.replace("Test system", "Renamed")))
                .andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"2\""))
                .andExpect(jsonPath("$.title").value("Renamed"));

        // stale version → 409 with current body
        mvc.perform(put("/api/diagrams/" + id).header("X-Api-Key", "test-key").header("If-Match", "\"1\"")
                        .contentType(MediaType.APPLICATION_JSON).content(DOC))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.title").value("Renamed"));

        // share link is public
        var shared = mvc.perform(post("/api/diagrams/" + id + "/share").header("X-Api-Key", "test-key"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.shared").value(true)).andReturn();
        String token = com.jayway.jsonpath.JsonPath.read(
                mvc.perform(get("/api/diagrams/" + id).header("X-Api-Key", "test-key")).andReturn().getResponse().getContentAsString(), "$.shareToken");
        mvc.perform(get("/api/share/" + token)).andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Renamed"));
        mvc.perform(delete("/api/diagrams/" + id + "/share").header("X-Api-Key", "test-key")).andExpect(status().isNoContent());
        mvc.perform(get("/api/share/" + token)).andExpect(status().isNotFound());

        mvc.perform(delete("/api/diagrams/" + id).header("X-Api-Key", "test-key")).andExpect(status().isNoContent());
        mvc.perform(get("/api/diagrams/" + id).header("X-Api-Key", "test-key")).andExpect(status().isNotFound());
        assert shared != null;
    }

    @Test
    void validatesDocumentShape() throws Exception {
        mvc.perform(post("/api/diagrams").header("X-Api-Key", "test-key").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"document\":{\"hello\":1}}"))
                .andExpect(status().isBadRequest());
    }
}
