package io.cistem.mcp;

import com.jayway.jsonpath.JsonPath;
import io.cistem.api.SecurityConfig;
import io.cistem.api.User;
import io.cistem.api.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.oauth2Login;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** The full MCP authorization dance against a real Postgres, then real tool calls over Streamable HTTP. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = { "cistem.public-url=http://localhost", "GITHUB_CLIENT_ID=x", "GITHUB_CLIENT_SECRET=y", "cistem.api-key=test-key" })
class McpOAuthFlowTest {

    @Autowired MockMvc mvc;
    @Autowired UserRepository users;

    static final String MCP_ACCEPT = "application/json, text/event-stream";

    @Test
    void unauthenticatedMcpCallAdvertisesResourceMetadata() throws Exception {
        mvc.perform(post("/mcp").contentType(MediaType.APPLICATION_JSON).header("Accept", MCP_ACCEPT).content("{}"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("WWW-Authenticate", containsString("resource_metadata=")));
        mvc.perform(get("/.well-known/oauth-protected-resource/mcp"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resource").value("http://localhost/mcp"))
                .andExpect(jsonPath("$.authorization_servers[0]").value("http://localhost"));
        mvc.perform(get("/.well-known/oauth-authorization-server"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.registration_endpoint").value("http://localhost/oauth2/register"))
                .andExpect(jsonPath("$.code_challenge_methods_supported", hasItem("S256")));
    }

    @Test
    void dynamicRegistrationCodeFlowAndToolCalls() throws Exception {
        User murtu = users.upsert("github", "4242", "murtu", "Murtu", null);

        // 1. the client registers itself (what claude.ai does when you add the connector)
        String reg = mvc.perform(post("/oauth2/register").contentType(MediaType.APPLICATION_JSON).content("""
                {"client_name":"Test MCP client","redirect_uris":["http://localhost:9999/callback"],
                 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"none"}"""))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String clientId = JsonPath.read(reg, "$.client_id");

        // 2. PKCE
        byte[] verifierBytes = new byte[32]; new java.security.SecureRandom().nextBytes(verifierBytes);
        String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(verifierBytes);
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));

        // 3. a browser that is NOT signed in is sent to GitHub first
        mvc.perform(get("/oauth2/authorize").accept(MediaType.TEXT_HTML)
                        .queryParam("response_type", "code").queryParam("client_id", clientId).queryParam("redirect_uri", "http://localhost:9999/callback")
                        .queryParam("code_challenge", challenge).queryParam("code_challenge_method", "S256").queryParam("state", "xyz")
                        .queryParam("resource", "http://localhost/mcp"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/oauth2/authorization/github"));

        // 4. signed in: no scopes requested → no consent page, straight to a code
        var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", "4242", "login", "murtu", SecurityConfig.USER_ID_ATTR, murtu.id().toString()), "login");
        MvcResult authz = mvc.perform(get("/oauth2/authorize").accept(MediaType.TEXT_HTML).with(oauth2Login().oauth2User(principal))
                        .queryParam("response_type", "code").queryParam("client_id", clientId).queryParam("redirect_uri", "http://localhost:9999/callback")
                        .queryParam("code_challenge", challenge).queryParam("code_challenge_method", "S256").queryParam("state", "xyz")
                        .queryParam("resource", "http://localhost/mcp"))
                .andExpect(status().is3xxRedirection()).andReturn();
        String location = authz.getResponse().getRedirectedUrl();
        assertNotNull(location);
        assertTrue(location.startsWith("http://localhost:9999/callback?"), location);
        String code = param(location, "code");
        assertEquals("xyz", param(location, "state"));

        // 5. exchange code for token (public client, PKCE)
        String tok = mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code").param("code", code).param("redirect_uri", "http://localhost:9999/callback")
                        .param("client_id", clientId).param("code_verifier", verifier).param("resource", "http://localhost/mcp"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.access_token").exists())
                .andExpect(jsonPath("$.token_type").value("Bearer"))
                .andReturn().getResponse().getContentAsString();
        String access = JsonPath.read(tok, "$.access_token");
        // public clients can't refresh, so the token must outlive a working session (was 5 minutes)
        assertTrue(((Number) JsonPath.read(tok, "$.expires_in")).longValue() >= 7 * 24 * 3600, "public client token lifetime: " + tok);
        // the JWT's subject is our user id, not the GitHub login
        String payload = new String(Base64.getUrlDecoder().decode(access.split("\\.")[1]), StandardCharsets.UTF_8);
        assertEquals(murtu.id().toString(), JsonPath.read(payload, "$.sub"));
        assertTrue(payload.contains("http://localhost/mcp"), "aud should contain the resource: " + payload);

        // 6. MCP: initialize, then tools/list, then create + evaluate via tools/call
        var initRes = mvc.perform(post("/mcp").header("Authorization", "Bearer " + access).header("Accept", MCP_ACCEPT).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"""))
                .andExpect(status().isOk())
                .andReturn().getResponse();
        String init = initRes.getContentAsString();
        assertTrue(init.contains("\"serverInfo\""), init);
        String session = initRes.getHeader("Mcp-Session-Id");
        assertNotNull(session, "Streamable HTTP should assign a session id");
        mcp(access, session, """
                {"jsonrpc":"2.0","method":"notifications/initialized"}""");

        String list = mcp(access, session, """
                {"jsonrpc":"2.0","id":2,"method":"tools/list"}""");
        assertTrue(list.contains("\"evaluate\"") && list.contains("\"add_component\""), list);

        String created = mcp(access, session, """
                {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_diagram","arguments":{"title":"From MCP","targetRps":2000}}}""");
        String diagramId = JsonPath.read(unwrap(created), "$.id");

        String added = mcp(access, session, """
                {"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"add_component","arguments":{"diagramId":"%s","kind":"service","name":"api","properties":{"instances":2,"rpsPerInstance":500}}}}""".formatted(diagramId));
        String svcId = JsonPath.read(unwrap(added), "$.componentId");
        mcp(access, session, """
                {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"connect","arguments":{"diagramId":"%s","from":"n1","to":"%s"}}}""".formatted(diagramId, svcId));
        String eval = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"evaluate","arguments":{"diagramId":"%s"}}}""".formatted(diagramId)));
        assertEquals("breaks", JsonPath.read(eval, "$.verdict"));           // 2000 rps into 2×500
        assertEquals("api", JsonPath.read(eval, "$.bottleneck"));

        // containers: AWS + IBM, api into AWS, a legacy service into IBM, a direct-connect link; crossing shows up in evaluate
        String aws = JsonPath.read(unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"add_container","arguments":{"diagramId":"%s","kind":"cloud","name":"AWS","provider":"aws"}}}""".formatted(diagramId))), "$.containerId");
        String ibm = JsonPath.read(unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"add_container","arguments":{"diagramId":"%s","kind":"datacentre","name":"IBM legacy","owner":"sister company"}}}""".formatted(diagramId))), "$.containerId");
        mcp(access, session, """
                {"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"move_component","arguments":{"diagramId":"%s","componentId":"%s","containerId":"%s"}}}""".formatted(diagramId, svcId, aws));
        String legacy = JsonPath.read(unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"add_component","arguments":{"diagramId":"%s","kind":"service","name":"legacy","containerId":"%s","properties":{"instances":20,"rpsPerInstance":500}}}}""".formatted(diagramId, ibm))), "$.componentId");
        mcp(access, session, """
                {"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"connect","arguments":{"diagramId":"%s","from":"%s","to":"%s"}}}""".formatted(diagramId, svcId, legacy));
        String linked = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"link_containers","arguments":{"diagramId":"%s","fromId":"%s","toId":"%s","type":"direct-connect"}}}""".formatted(diagramId, aws, ibm)));
        List<Map<String, Object>> crossings = JsonPath.read(linked, "$.evaluation.boundaryCrossings");
        var toLegacy = crossings.stream().filter(x -> "legacy".equals(x.get("to"))).findFirst().orElseThrow(() -> new AssertionError(linked));
        assertEquals(10, ((Number) toLegacy.get("addedLatencyMs")).intValue(), "direct-connect default");
        var toApi = crossings.stream().filter(x -> "api".equals(x.get("to"))).findFirst().orElseThrow();
        assertEquals(1, ((Number) toApi.get("addedLatencyMs")).intValue(), "unplaced clients → AWS is a sibling-level hop");
        String containers = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"list_containers","arguments":{"diagramId":"%s"}}}""".formatted(diagramId)));
        assertTrue(containers.contains("\"IBM legacy\"") && containers.contains("legacy"), containers);
        // a container can't be put inside itself
        String bad = mcp(access, session, """
                {"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"set_container","arguments":{"diagramId":"%s","containerId":"%s","properties":{"parent":"%s"}}}}""".formatted(diagramId, aws, aws));
        assertTrue(bad.contains("inside itself"), bad);
        // organise writes frames
        String org = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"auto_organise","arguments":{"diagramId":"%s"}}}""".formatted(diagramId)));
        assertNotNull(org);
        String doc = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(diagramId)));
        assertEquals(Integer.valueOf(3), JsonPath.read(doc, "$.version"));
        assertNotNull(JsonPath.read(doc, "$.layout.frames." + aws + ".w"));

        // the diagram is owned by murtu and visible through the REST API as that user
        mvc.perform(get("/api/diagrams/" + diagramId).with(oauth2Login().oauth2User(principal)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("From MCP"));

        // a token for a different resource is refused
        mvc.perform(post("/mcp").header("Authorization", "Bearer not.a.jwt").header("Accept", MCP_ACCEPT).contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    private String mcp(String access, String session, String body) throws Exception {
        var req = post("/mcp").header("Authorization", "Bearer " + access).header("Accept", MCP_ACCEPT).contentType(MediaType.APPLICATION_JSON).content(body);
        if (session != null) req = req.header("Mcp-Session-Id", session);
        var res = mvc.perform(req).andReturn().getResponse();
        assertTrue(res.getStatus() == 200 || res.getStatus() == 202, "status " + res.getStatus() + ": " + res.getContentAsString());
        return res.getContentAsString();
    }

    /** Streamable HTTP may answer as JSON or as an SSE frame; pull the JSON-RPC result either way. */
    private static String unwrap(String response) { return unwrap(response, true); }
    private static String unwrap(String response, boolean failOnError) {
        String json = response.trim();
        if (!json.startsWith("{")) {   // SSE frame: id:/event:/data: lines
            StringBuilder sb = new StringBuilder();
            for (String line : json.split("\n")) if (line.startsWith("data:")) sb.append(line.substring(5).trim());
            json = sb.toString();
        }
        if (JsonPath.read(json, "$.result.isError") instanceof Boolean b && b && failOnError) fail("tool error: " + json);
        return JsonPath.read(json, "$.result.content[0].text");
    }

    private static String param(String url, String name) {
        for (String kv : URI.create(url).getRawQuery().split("&")) {
            String[] p = kv.split("=", 2);
            if (p[0].equals(name)) return URLDecoder.decode(p[1], StandardCharsets.UTF_8);
        }
        return null;
    }
}
