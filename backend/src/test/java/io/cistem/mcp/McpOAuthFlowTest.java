package io.cistem.mcp;

import com.jayway.jsonpath.JsonPath;
import io.cistem.auth.SecurityConfig;
import io.cistem.auth.User;
import io.cistem.auth.UserRepository;
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

    /** A confidential client (how Claude registers) must be able to refresh — with or without `resource`. */
    @Test
    void confidentialClientRefreshes() throws Exception {
        User murtu = users.upsert("github", "4243", "murtu2", "Murtu", null);
        String reg = mvc.perform(post("/oauth2/register").contentType(MediaType.APPLICATION_JSON).content("""
                {"client_name":"Claude","redirect_uris":["http://localhost:9999/callback"],
                 "grant_types":["authorization_code","refresh_token"],"response_types":["code"],"token_endpoint_auth_method":"client_secret_post"}"""))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        String clientId = JsonPath.read(reg, "$.client_id"), secret = JsonPath.read(reg, "$.client_secret");
        byte[] vb = new byte[32]; new java.security.SecureRandom().nextBytes(vb);
        String verifier = Base64.getUrlEncoder().withoutPadding().encodeToString(vb);
        String challenge = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", "4243", "login", "murtu2", SecurityConfig.USER_ID_ATTR, murtu.id().toString()), "login");
        String location = mvc.perform(get("/oauth2/authorize").accept(MediaType.TEXT_HTML).with(oauth2Login().oauth2User(principal))
                        .queryParam("response_type", "code").queryParam("client_id", clientId).queryParam("redirect_uri", "http://localhost:9999/callback")
                        .queryParam("code_challenge", challenge).queryParam("code_challenge_method", "S256").queryParam("state", "s")
                        .queryParam("resource", "http://localhost/mcp"))
                .andExpect(status().is3xxRedirection()).andReturn().getResponse().getRedirectedUrl();
        String tok = mvc.perform(post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("grant_type", "authorization_code").param("code", param(location, "code")).param("redirect_uri", "http://localhost:9999/callback")
                        .param("client_id", clientId).param("client_secret", secret).param("code_verifier", verifier).param("resource", "http://localhost/mcp"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String refresh = JsonPath.read(tok, "$.refresh_token");
        assertNotNull(refresh, "confidential client gets a refresh token: " + tok);
        for (boolean withResource : new boolean[] { true, false }) {
            var req = post("/oauth2/token").contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .param("grant_type", "refresh_token").param("refresh_token", refresh).param("client_id", clientId).param("client_secret", secret);
            if (withResource) req = req.param("resource", "http://localhost/mcp");
            var res = mvc.perform(req).andReturn().getResponse();
            assertEquals(200, res.getStatus(), "refresh (resource=" + withResource + "): " + res.getContentAsString());
            String at = JsonPath.read(res.getContentAsString(), "$.access_token");
            String payload = new String(Base64.getUrlDecoder().decode(at.split("\\.")[1]), StandardCharsets.UTF_8);
            assertEquals(murtu.id().toString(), JsonPath.read(payload, "$.sub"), "refreshed token keeps our user id as sub");
            assertTrue(payload.contains("http://localhost/mcp"), "refreshed token is for /mcp: " + payload);
            if (res.getContentAsString().contains("refresh_token")) refresh = JsonPath.read(res.getContentAsString(), "$.refresh_token");
        }
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
        assertEquals(Integer.valueOf(io.cistem.engine.Migrate.VERSION), JsonPath.read(doc, "$.version"));
        assertNotNull(JsonPath.read(doc, "$.layout.frames." + aws + ".w"));

        // sequence diagrams: created from text, linked to this system diagram, readable and replaceable as text
        String seqRes = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":30,"method":"tools/call","params":{"name":"create_sequence","arguments":{"title":"Checkout flow","systemDiagramId":"%s","text":"participant web\\nparticipant api @%s\\nweb -> api: POST /orders\\napi --> web: 201"}}}""".formatted(diagramId, svcId)));
        String seqId = JsonPath.read(seqRes, "$.diagramId");
        String got = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"get_sequence","arguments":{"diagramId":"%s"}}}""".formatted(seqId)));
        assertEquals("participant web\nparticipant api @" + svcId + "\n\nweb -> api: POST /orders\napi --> web: 201\n", JsonPath.read(got, "$.text"));
        assertEquals(diagramId, JsonPath.read(got, "$.uses.id"));
        String set = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"set_sequence","arguments":{"diagramId":"%s","text":"web -> api: GET /orders\\nloop each\\n  api ->> q: x\\nend"}}}""".formatted(seqId)));
        assertTrue(((String) JsonPath.read(set, "$.text")).contains("loop each"), set);
        String badSeq = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":33,"method":"tools/call","params":{"name":"set_sequence","arguments":{"diagramId":"%s","text":"web -> : oops"}}}""".formatted(seqId)), false);
        assertTrue(badSeq.contains("line 1"), badSeq);
        // system tools refuse a sequence, plainly
        String wrongKind = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":34,"method":"tools/call","params":{"name":"evaluate","arguments":{"diagramId":"%s"}}}""".formatted(seqId)), false);
        assertTrue(wrongKind.contains("sequence diagram"), wrongKind);
        String listed = mvc.perform(get("/api/diagrams").with(oauth2Login().oauth2User(principal))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(((java.util.List<?>) JsonPath.read(listed, "$[?(@.title=='Checkout flow')].kind")).contains("sequence"), listed);
        // class diagrams: JSON in, validated, relation ids kept across a replace
        String cd = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"create_class_diagram","arguments":{"title":"Domain","classes":[{"name":"Order","fields":[{"name":"id","type":"UUID"}],"methods":[{"name":"total","type":"Money"}]},{"name":"Money","kind":"record","fields":[{"vis":"","name":"amountMinor","type":"long"}]},{"name":"Status","kind":"enum","fields":["NEW","PAID"]}],"relations":[{"from":"Order","to":"Money","type":"assoc","label":"total"}]}}}"""));
        String cdId = JsonPath.read(cd, "$.diagramId");
        String cdDoc = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(cdId)));
        assertEquals("class", JsonPath.read(cdDoc, "$.kind"));
        assertEquals("-", JsonPath.read(cdDoc, "$.model.classes[0].fields[0].vis"), "fields default to private");
        assertEquals("+", JsonPath.read(cdDoc, "$.model.classes[0].methods[0].vis"), "methods default to public");
        assertEquals("NEW", JsonPath.read(cdDoc, "$.model.classes[2].fields[0].name"));
        String relId = JsonPath.read(cdDoc, "$.model.relations[0].id");
        String set2 = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"set_class_diagram","arguments":{"diagramId":"%s","classes":[{"name":"Order"},{"name":"Money","kind":"record"}],"relations":[{"from":"Order","to":"Money","type":"assoc"},{"from":"Order","to":"Money","type":"composition"}]}}}""".formatted(cdId)));
        assertEquals(Integer.valueOf(2), JsonPath.read(set2, "$.relations"));
        String cdDoc2 = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":43,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(cdId)));
        assertEquals(relId, JsonPath.read(cdDoc2, "$.model.relations[0].id"), "relation id kept");
        String badCd = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":44,"method":"tools/call","params":{"name":"set_class_diagram","arguments":{"diagramId":"%s","classes":[{"name":"Order"}],"relations":[{"from":"Order","to":"Nope","type":"assoc"}]}}}""".formatted(cdId)), false);
        assertTrue(badCd.contains("both ends"), badCd);
        String wrong2 = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":45,"method":"tools/call","params":{"name":"add_component","arguments":{"diagramId":"%s","kind":"service","name":"x"}}}""".formatted(cdId)), false);
        assertTrue(wrong2.contains("class diagram"), wrong2);
        // notes: on the canvas and on items, in any kind; replacing the model keeps them
        String note = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":50,"method":"tools/call","params":{"name":"add_note","arguments":{"diagramId":"%s","text":"## Decisions\\n- [ ] money as minor units","color":"blue"}}}""".formatted(cdId)));
        String noteId = JsonPath.read(note, "$.noteId");
        unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":51,"method":"tools/call","params":{"name":"set_item_notes","arguments":{"diagramId":"%s","itemId":"Order","text":"**aggregate root**"}}}""".formatted(cdId)));
        unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":52,"method":"tools/call","params":{"name":"set_class_diagram","arguments":{"diagramId":"%s","classes":[{"name":"Order"},{"name":"Money","kind":"record"}],"relations":[]}}}""".formatted(cdId)));
        String withNotes = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":53,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(cdId)));
        assertEquals("## Decisions\n- [ ] money as minor units", JsonPath.read(withNotes, "$.model.notes[0].text"));
        assertEquals("blue", JsonPath.read(withNotes, "$.model.notes[0].color"));
        assertEquals("**aggregate root**", JsonPath.read(withNotes, "$.model.classes[0].notes"), "item notes survive a replace");
        assertEquals(Integer.valueOf(280), JsonPath.read(withNotes, "$.layout.notes." + noteId + ".w"));
        String badColour = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":54,"method":"tools/call","params":{"name":"update_note","arguments":{"diagramId":"%s","noteId":"%s","color":"neon"}}}""".formatted(cdId, noteId)), false);
        assertTrue(badColour.contains("color must be one of"), badColour);
        unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":55,"method":"tools/call","params":{"name":"remove_note","arguments":{"diagramId":"%s","noteId":"%s"}}}""".formatted(cdId, noteId)));
        String noNotes = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":56,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(cdId)));
        assertTrue(!noNotes.contains("\"notes\":[") && !noNotes.contains("Decisions"), noNotes);

        // projects: create one, create a diagram straight into it, move another in; the moved one keeps its version
        // (and its updatedAt, so it lists after the new one)
        String proj = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":60,"method":"tools/call","params":{"name":"create_project","arguments":{"title":"MCP project"}}}"""));
        String projectId = JsonPath.read(proj, "$.id");
        String inProject = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":61,"method":"tools/call","params":{"name":"create_diagram","arguments":{"title":"In project","projectId":"%s"}}}""".formatted(projectId)));
        assertEquals(projectId, JsonPath.read(inProject, "$.projectId"));
        List<Object> cdVersions = JsonPath.read(unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":62,"method":"tools/call","params":{"name":"list_diagrams","arguments":{}}}""")), "$[?(@.id=='" + cdId + "')].version");
        String cdVersion = String.valueOf(cdVersions.get(0));
        String moved = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":63,"method":"tools/call","params":{"name":"move_to_project","arguments":{"diagramId":"%s","projectId":"%s"}}}""".formatted(cdId, projectId)));
        assertEquals(projectId, JsonPath.read(moved, "$.projectId"));
        assertEquals(cdVersion, String.valueOf((Object) JsonPath.read(moved, "$.version")), "moving keeps the version");
        String projectsList = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":64,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}"""));
        assertEquals(List.of("In project", "Domain"), JsonPath.read(projectsList, "$[?(@.id=='" + projectId + "')].diagrams[*].title"), projectsList);
        String filtered = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":65,"method":"tools/call","params":{"name":"list_diagrams","arguments":{"projectId":"%s"}}}""".formatted(projectId)));
        assertEquals(List.of("In project", "Domain"), JsonPath.read(filtered, "$[*].title"));
        String renamed = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":66,"method":"tools/call","params":{"name":"rename_project","arguments":{"projectId":"%s","title":"Renamed project"}}}""".formatted(projectId)));
        assertEquals("Renamed project", JsonPath.read(renamed, "$.title"));
        assertTrue(list.contains("\"delete_project\"") && list.contains("AND every diagram"), "delete_project warns about its diagrams");
        unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":67,"method":"tools/call","params":{"name":"delete_project","arguments":{"projectId":"%s"}}}""".formatted(projectId)));
        String afterDelete = unwrap(mcp(access, session, """
                {"jsonrpc":"2.0","id":68,"method":"tools/call","params":{"name":"get_diagram","arguments":{"diagramId":"%s"}}}""".formatted(cdId)), false);
        assertTrue(afterDelete.contains("No such diagram"), afterDelete);


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
