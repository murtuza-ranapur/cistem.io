package io.cistem.api;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.contains;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Runs against the DATABASE_URL in the environment (CI and local dev both provide one). */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = { "cistem.api-key=test-key", "GITHUB_CLIENT_ID=x", "GITHUB_CLIENT_SECRET=y" })
class DiagramApiTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;

    User alice, bob;

    @BeforeEach
    void users() {
        alice = users.upsert("github", "1001", "alice", "Alice", null);
        bob = users.upsert("github", "1002", "bob", "Bob", null);
    }

    /** A signed-in browser session for the given user. */
    RequestPostProcessor as(User u) {
        OAuth2User principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", u.providerId(), "login", u.login(), SecurityConfig.USER_ID_ATTR, u.id().toString()), "login");
        return oauth2Login().oauth2User(principal);
    }

    MockHttpServletRequestBuilder json(MockHttpServletRequestBuilder b, String body) {
        return b.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    static final String DOC = """
            {"document":{"version":2,"kind":"system","meta":{"title":"Test system","created":"2026-01-01T00:00:00Z","updated":"2026-01-01T00:00:00Z"},
             "model":{"targetRps":1000,"nodes":[],"edges":[]},"layout":{"positions":{}}}}""";

    @Autowired org.springframework.session.SessionRepository<? extends org.springframework.session.Session> sessions;
    @Autowired org.springframework.session.web.http.CookieSerializer cookies;

    @Test
    void sessionsLastThirtyDaysAndTheCookieSurvivesBrowserRestarts() {
        // regression: @EnableJdbcHttpSession made Boot ignore spring.session.timeout → 30-minute sign-outs
        org.junit.jupiter.api.Assertions.assertEquals(java.time.Duration.ofDays(30), sessions.createSession().getMaxInactiveInterval());
        var req = new org.springframework.mock.web.MockHttpServletRequest(); var res = new org.springframework.mock.web.MockHttpServletResponse();
        cookies.writeCookieValue(new org.springframework.session.web.http.CookieSerializer.CookieValue(req, res, "abc"));
        String setCookie = res.getHeader("Set-Cookie");
        org.junit.jupiter.api.Assertions.assertTrue(setCookie.startsWith("cistem_session=") && setCookie.contains("Max-Age=2592000") && setCookie.contains("HttpOnly"), setCookie);
    }

    @Test
    void signedOutGets401OnApiAndMe() throws Exception {
        mvc.perform(get("/api/diagrams")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/me")).andExpect(status().isUnauthorized());
    }

    @Test
    void meReturnsProfile() throws Exception {
        mvc.perform(get("/api/me").with(as(alice)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.login").value("alice"))
                .andExpect(jsonPath("$.id").value(alice.id().toString()));
    }

    @Test
    void crudIsScopedToOwnerWithOptimisticConcurrency() throws Exception {
        var created = mvc.perform(json(post("/api/diagrams"), DOC).with(as(alice)).with(csrf()))
                .andExpect(status().isCreated())
                .andExpect(header().string("ETag", "\"1\""))
                .andExpect(jsonPath("$.title").value("Test system"))
                .andReturn();
        String id = com.jayway.jsonpath.JsonPath.read(created.getResponse().getContentAsString(), "$.id");

        mvc.perform(get("/api/diagrams").with(as(alice)))
                .andExpect(jsonPath("$[?(@.id=='" + id + "')].title", contains("Test system")))
                .andExpect(jsonPath("$[0].document").doesNotExist());

        // bob can't see, change or delete alice's diagram
        mvc.perform(get("/api/diagrams/" + id).with(as(bob))).andExpect(status().isNotFound());
        mvc.perform(json(put("/api/diagrams/" + id), DOC).with(as(bob)).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(delete("/api/diagrams/" + id).with(as(bob)).with(csrf())).andExpect(status().isNotFound());
        mvc.perform(get("/api/diagrams").with(as(bob))).andExpect(jsonPath("$[?(@.id=='" + id + "')]").isEmpty());

        // matching version → 200, bumps
        mvc.perform(json(put("/api/diagrams/" + id), DOC.replace("Test system", "Renamed")).with(as(alice)).with(csrf()).header("If-Match", "\"1\""))
                .andExpect(status().isOk()).andExpect(header().string("ETag", "\"2\""));
        // stale → 409 with current
        mvc.perform(json(put("/api/diagrams/" + id), DOC).with(as(alice)).with(csrf()).header("If-Match", "\"1\""))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.version").value(2)).andExpect(jsonPath("$.title").value("Renamed"));

        // share is public and hides the token
        var shared = mvc.perform(post("/api/diagrams/" + id + "/share").with(as(alice)).with(csrf()))
                .andExpect(status().isOk()).andReturn();
        String token = com.jayway.jsonpath.JsonPath.read(shared.getResponse().getContentAsString(), "$.shareToken");
        mvc.perform(get("/api/share/" + token)).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Renamed")).andExpect(jsonPath("$.shareToken").doesNotExist());
        mvc.perform(delete("/api/diagrams/" + id + "/share").with(as(alice)).with(csrf())).andExpect(status().isNoContent());
        mvc.perform(get("/api/share/" + token)).andExpect(status().isNotFound());

        // csrf is enforced for cookie sessions
        mvc.perform(delete("/api/diagrams/" + id).with(as(alice))).andExpect(status().isForbidden());
        mvc.perform(delete("/api/diagrams/" + id).with(as(alice)).with(csrf())).andExpect(status().isNoContent());
    }

    @Test
    void apiKeyActsAsAnAccountWithoutCsrf() throws Exception {
        var created = mvc.perform(json(post("/api/diagrams"), DOC).header("X-Api-Key", "test-key"))
                .andExpect(status().isCreated()).andReturn();
        String id = com.jayway.jsonpath.JsonPath.read(created.getResponse().getContentAsString(), "$.id");
        mvc.perform(get("/api/diagrams/" + id).header("Authorization", "Bearer test-key")).andExpect(status().isOk());
        mvc.perform(get("/api/diagrams").header("X-Api-Key", "wrong")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/diagrams/" + id).header("X-Api-Key", "test-key")).andExpect(status().isNoContent());
    }

    @Test
    void validatesDocumentShape() throws Exception {
        mvc.perform(json(post("/api/diagrams"), "{\"document\":{\"hello\":1}}").with(as(alice)).with(csrf()))
                .andExpect(status().isBadRequest());
        // unknown kinds (they end up in the UI) and versions from the future are refused
        mvc.perform(json(post("/api/diagrams"), "{\"document\":{\"version\":4,\"kind\":\"<img src=x onerror=alert(1)>\",\"model\":{}}}").with(as(alice)).with(csrf()))
                .andExpect(status().isBadRequest());
        mvc.perform(json(post("/api/diagrams"), "{\"document\":{\"version\":9,\"kind\":\"system\",\"model\":{}}}").with(as(alice)).with(csrf()))
                .andExpect(status().isBadRequest());
    }

    @Test
    void putWithoutIfMatchStillChecksTheBodyVersion() throws Exception {
        String created = mvc.perform(json(post("/api/diagrams"), DOC).with(as(alice)).with(csrf())).andReturn().getResponse().getContentAsString();
        String id = com.jayway.jsonpath.JsonPath.read(created, "$.id");
        mvc.perform(json(put("/api/diagrams/" + id), DOC.replaceFirst("\\{", "{\"version\":999,")).with(as(alice)).with(csrf()))
                .andExpect(status().isConflict());
    }
}
