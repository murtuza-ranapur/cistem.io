package io.cistem.project;

import com.jayway.jsonpath.JsonPath;
import io.cistem.auth.SecurityConfig;
import io.cistem.auth.User;
import io.cistem.auth.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Projects over the REST API. Each test gets fresh users, so it starts with an account that has no projects. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = { "cistem.api-key=test-key", "GITHUB_CLIENT_ID=x", "GITHUB_CLIENT_SECRET=y" })
class ProjectApiTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired JdbcClient jdbc;

    User alice, bob;

    @BeforeEach
    void users() {
        alice = users.upsert("github", "p-" + UUID.randomUUID(), "alice", "Alice", null);
        bob = users.upsert("github", "p-" + UUID.randomUUID(), "bob", "Bob", null);
    }

    static final String DOC = """
            {"version":2,"kind":"system","meta":{"title":"%s","created":"2026-01-01T00:00:00Z","updated":"2026-01-01T00:00:00Z"},
             "model":{"targetRps":1000,"nodes":[],"edges":[]},"layout":{"positions":{}}}""";

    @Test
    void theDefaultProjectIsCreatedOnFirstListAndNeverDuplicated() throws Exception {
        perform(get("/api/projects"), alice).andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].title").value("My diagrams"))
                .andExpect(jsonPath("$[0].shared").value(false))
                .andExpect(jsonPath("$[0].diagrams", hasSize(0)));
        perform(get("/api/projects"), alice).andExpect(jsonPath("$", hasSize(1)));
    }

    @Test
    void aDiagramWithoutAProjectGoesInTheDefaultOne() throws Exception {
        String diagram = createDiagram(alice, "Loose", null);
        String projects = body(perform(get("/api/projects"), alice));
        assertEquals(List.of("My diagrams"), JsonPath.read(projects, "$[*].title"));
        assertEquals(JsonPath.read(projects, "$[0].id"), JsonPath.<String>read(diagram, "$.projectId"));
        assertEquals(List.of("Loose"), JsonPath.read(projects, "$[0].diagrams[*].title"));
        // ... and the default stays the oldest project, not the newest
        String other = createProject(alice, "Other");
        assertEquals(JsonPath.read(projects, "$[0].id"), JsonPath.<String>read(createDiagram(alice, "Loose 2", null), "$.projectId"));
        assertNotEquals(id(other), JsonPath.read(projects, "$[0].id"));
    }

    @Test
    void lifecycle() throws Exception {
        // create (title trimmed and required)
        String payments = createProject(alice, "  Payments  ");
        assertEquals("Payments", JsonPath.read(payments, "$.title"));
        assertEquals(List.of(), JsonPath.read(payments, "$.diagrams"));
        perform(json(post("/api/projects"), "{\"title\":\"   \"}"), alice).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").exists());
        perform(json(post("/api/projects"), "{\"title\":\"" + "x".repeat(201) + "\"}"), alice).andExpect(status().isBadRequest());
        String pid = id(payments);

        // a diagram created in it; listing puts the project and its diagrams newest-updated first
        String checkout = createDiagram(alice, "Checkout", pid);
        assertEquals(pid, JsonPath.read(checkout, "$.projectId"));
        String refunds = createDiagram(alice, "Refunds", pid);
        perform(get("/api/projects"), alice)
                .andExpect(jsonPath("$[0].id").value(pid))
                .andExpect(jsonPath("$[0].diagrams[*].title", contains("Refunds", "Checkout")))
                .andExpect(jsonPath("$[0].diagrams[0].projectId").value(pid))
                .andExpect(jsonPath("$[0].diagrams[0].document").doesNotExist());
        perform(get("/api/diagrams/" + id(checkout)), alice).andExpect(jsonPath("$.projectId").value(pid));

        // move to another project: same id, version and document; the target becomes the newest-updated project
        String archive = createProject(alice, "Archive");
        String saved = body(perform(json(put("/api/diagrams/" + id(checkout)), "{\"document\":" + DOC.formatted("Checkout v2") + "}"), alice).andExpect(status().isOk()));
        perform(json(post("/api/projects"), "{\"title\":\"Newer\"}"), alice).andExpect(status().isCreated());
        perform(json(put("/api/diagrams/" + id(checkout) + "/project"), "{\"projectId\":\"" + id(archive) + "\"}"), alice)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id(checkout)))
                .andExpect(jsonPath("$.projectId").value(id(archive)))
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.document").doesNotExist());
        String moved = body(perform(get("/api/diagrams/" + id(checkout)), alice));
        assertEquals(Integer.valueOf(2), JsonPath.read(moved, "$.version"));
        assertEquals(JsonPath.<Object>read(saved, "$.document"), JsonPath.read(moved, "$.document"));
        assertEquals(JsonPath.<String>read(saved, "$.updatedAt"), JsonPath.read(moved, "$.updatedAt"), "moving doesn't count as an edit");
        perform(get("/api/projects"), alice)
                .andExpect(jsonPath("$[0].id").value(id(archive)))
                .andExpect(jsonPath("$[0].diagrams[*].title", contains("Checkout v2")))
                .andExpect(jsonPath("$[?(@.id=='" + pid + "')].diagrams[*].title", contains("Refunds")));

        // rename
        perform(json(patch("/api/projects/" + pid), "{\"title\":\"Payments v2\"}"), alice)
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Payments v2"))
                .andExpect(jsonPath("$.diagrams[*].title", contains("Refunds")));

        // share: public, full documents, no tokens or owner; then unshare → 404
        String shared = body(perform(post("/api/projects/" + pid + "/share"), alice).andExpect(status().isOk())
                .andExpect(jsonPath("$.shared").value(true)));
        String token = JsonPath.read(shared, "$.shareToken");
        assertEquals(24, token.length());
        // the owner sees the existing link without rotating it
        perform(get("/api/projects"), alice).andExpect(jsonPath("$[?(@.id=='" + pid + "')].shareToken", contains(token)));
        perform(json(patch("/api/projects/" + pid), "{\"title\":\"Payments v2\"}"), alice).andExpect(jsonPath("$.shareToken").value(token));
        perform(post("/api/diagrams/" + id(refunds) + "/share"), alice).andExpect(status().isOk());
        createDiagram(alice, "Settlement", pid);
        String pub = mvc.perform(get("/api/share/project/" + token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Payments v2"))
                .andExpect(jsonPath("$.diagrams[*].title", contains("Settlement", "Refunds")))
                .andExpect(jsonPath("$.diagrams[0].document.model").exists())
                .andExpect(jsonPath("$.diagrams[1].shareToken").doesNotExist())
                .andExpect(jsonPath("$.shareToken").doesNotExist())
                .andExpect(jsonPath("$.id").doesNotExist())
                .andReturn().getResponse().getContentAsString();
        assertFalse(pub.contains(alice.id().toString()) || pub.contains("alice"), pub);
        // rotating gives a new token and retires the old one
        String rotated = JsonPath.read(body(perform(post("/api/projects/" + pid + "/share"), alice)), "$.shareToken");
        assertNotEquals(token, rotated);
        mvc.perform(get("/api/share/project/" + token)).andExpect(status().isNotFound());
        perform(delete("/api/projects/" + pid + "/share"), alice).andExpect(status().isNoContent());
        mvc.perform(get("/api/share/project/" + rotated)).andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("No such project"));
        perform(get("/api/projects"), alice).andExpect(jsonPath("$[?(@.id=='" + pid + "')].shared", contains(false)))
                .andExpect(jsonPath("$[?(@.id=='" + pid + "')].shareToken").isEmpty());

        // delete takes its diagrams with it; the moved-out one survives
        perform(delete("/api/projects/" + pid), alice).andExpect(status().isNoContent());
        perform(get("/api/diagrams/" + id(refunds)), alice).andExpect(status().isNotFound());
        perform(get("/api/diagrams/" + id(checkout)), alice).andExpect(status().isOk());
        perform(get("/api/projects"), alice).andExpect(jsonPath("$[?(@.id=='" + pid + "')]").isEmpty());
        perform(delete("/api/projects/" + pid), alice).andExpect(status().isNotFound());
    }

    @Test
    void deletingTheLastProjectIsAllowedAndTheDefaultComesBack() throws Exception {
        String only = createProject(alice, "Only");
        createDiagram(alice, "Doomed", id(only));
        perform(delete("/api/projects/" + id(only)), alice).andExpect(status().isNoContent());
        assertEquals(0, jdbc.sql("select count(*) from projects where owner_id = :o").param("o", alice.id()).query(Integer.class).single());
        String d = createDiagram(alice, "Fresh", null);
        perform(get("/api/projects"), alice)
                .andExpect(jsonPath("$[*].title", contains("My diagrams")))
                .andExpect(jsonPath("$[0].id").value(JsonPath.<String>read(d, "$.projectId")));
    }

    @Test
    void projectsAreScopedToTheirOwner() throws Exception {
        String pid = id(createProject(alice, "Alice's"));
        String aliceDiagram = id(createDiagram(alice, "Secret", pid));
        String bobProject = id(createProject(bob, "Bob's"));
        String bobDiagram = id(createDiagram(bob, "Bob's diagram", bobProject));

        perform(get("/api/projects"), bob).andExpect(jsonPath("$[?(@.id=='" + pid + "')]").isEmpty());
        perform(json(patch("/api/projects/" + pid), "{\"title\":\"pwned\"}"), bob).andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("No such project"));
        perform(post("/api/projects/" + pid + "/share"), bob).andExpect(status().isNotFound());
        perform(delete("/api/projects/" + pid + "/share"), bob).andExpect(status().isNotFound());
        perform(delete("/api/projects/" + pid), bob).andExpect(status().isNotFound());
        // can't create in it, move into it, or move alice's diagram out of it
        perform(json(post("/api/diagrams"), "{\"projectId\":\"" + pid + "\",\"document\":" + DOC.formatted("x") + "}"), bob).andExpect(status().isNotFound());
        perform(json(put("/api/diagrams/" + bobDiagram + "/project"), "{\"projectId\":\"" + pid + "\"}"), bob).andExpect(status().isNotFound());
        perform(json(put("/api/diagrams/" + aliceDiagram + "/project"), "{\"projectId\":\"" + bobProject + "\"}"), bob).andExpect(status().isNotFound());
        // and alice can't move into bob's
        perform(json(put("/api/diagrams/" + aliceDiagram + "/project"), "{\"projectId\":\"" + bobProject + "\"}"), alice).andExpect(status().isNotFound());

        perform(get("/api/projects"), alice)
                .andExpect(jsonPath("$[?(@.id=='" + pid + "')].title", contains("Alice's")))
                .andExpect(jsonPath("$[?(@.id=='" + pid + "')].diagrams[*].title", contains("Secret")));
        perform(get("/api/diagrams/" + bobDiagram), bob).andExpect(jsonPath("$.projectId").value(bobProject));
        mvc.perform(get("/api/projects")).andExpect(status().isUnauthorized());
    }

    @Test
    void everyOwnedDiagramIsInOneOfItsOwnersProjects() {
        // the V4 backfill put existing diagrams in a "My diagrams" project per owner, and the service keeps it that way
        int orphans = jdbc.sql("""
                select count(*) from diagrams d left join projects p on p.id = d.project_id
                where d.owner_id is not null and (p.id is null or p.owner_id <> d.owner_id)""").query(Integer.class).single();
        assertEquals(0, orphans);
    }

    // ---------- helpers ----------

    String createProject(User u, String title) throws Exception {
        return body(perform(json(post("/api/projects"), "{\"title\":\"" + title + "\"}"), u).andExpect(status().isCreated()));
    }

    String createDiagram(User u, String title, String projectId) throws Exception {
        String project = projectId == null ? "" : "\"projectId\":\"" + projectId + "\",";
        return body(perform(json(post("/api/diagrams"), "{" + project + "\"document\":" + DOC.formatted(title) + "}"), u).andExpect(status().isCreated()));
    }

    ResultActions perform(MockHttpServletRequestBuilder req, User u) throws Exception {
        return mvc.perform(req.with(as(u)).with(csrf()));
    }

    RequestPostProcessor as(User u) {
        OAuth2User principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", u.providerId(), "login", u.login(), SecurityConfig.USER_ID_ATTR, u.id().toString()), "login");
        return oauth2Login().oauth2User(principal);
    }

    static MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    static String body(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    static String id(String json) {
        return JsonPath.read(json, "$.id");
    }
}
