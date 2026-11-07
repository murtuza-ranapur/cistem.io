package io.cistem.probe;

import io.cistem.api.SecurityConfig;
import io.cistem.api.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextImpl;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.session.Session;
import org.springframework.test.context.TestPropertySource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.Map;

/** Manual probe (not part of CI): writes a signed-in session to the database, prints its cookie value. */
@SpringBootTest
@TestPropertySource(properties = { "GITHUB_CLIENT_ID=x", "GITHUB_CLIENT_SECRET=y" })
@EnabledIfSystemProperty(named = "probe", matches = "session")
class SessionProbeTest {
    @Autowired FindByIndexNameSessionRepository<? extends Session> sessions;
    @Autowired UserRepository users;

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void writeSession() throws Exception {
        var u = users.upsert("github", "4242", "probe", "Probe", null);
        var principal = new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")),
                Map.of("id", 4242, "login", "probe", SecurityConfig.USER_ID_ATTR, u.id().toString()), "login");
        var auth = new OAuth2AuthenticationToken(principal, principal.getAuthorities(), "github");
        FindByIndexNameSessionRepository repo = sessions;
        Session s = repo.createSession();
        s.setAttribute("SPRING_SECURITY_CONTEXT", new SecurityContextImpl(auth));
        repo.save(s);
        Files.writeString(Path.of(System.getProperty("probe.out")), Base64.getEncoder().encodeToString(s.getId().getBytes()));
    }
}
