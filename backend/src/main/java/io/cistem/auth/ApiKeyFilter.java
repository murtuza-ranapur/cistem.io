package io.cistem.auth;

import io.cistem.web.CistemProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Optional shared key for scripts and the MCP server, sent as {@code X-Api-Key} or
 * {@code Authorization: Bearer}. It acts as the account named by {@code CISTEM_API_KEY_LOGIN}
 * (default: the first user who ever signed in). Browser users never see this path.
 */
@Component
public class ApiKeyFilter extends OncePerRequestFilter {

    public record ApiKeyPrincipal(UUID userId, String login) {}

    private final CistemProperties props;
    private final JdbcClient jdbc;
    private final String keyLogin;

    public ApiKeyFilter(CistemProperties props, JdbcClient jdbc, org.springframework.core.env.Environment env) {
        this.props = props;
        this.jdbc = jdbc;
        this.keyLogin = env.getProperty("CISTEM_API_KEY_LOGIN", "");
    }

    /** On /mcp only X-Api-Key counts: Bearer there is an OAuth access token. */
    public static boolean hasApiKey(HttpServletRequest req) {
        if (req.getHeader("X-Api-Key") != null) return true;
        if (req.getRequestURI().startsWith("/mcp")) return false;
        return req.getHeader("Authorization") != null && req.getHeader("Authorization").startsWith("Bearer ");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String p = req.getRequestURI();
        return !props.apiKeyEnabled() || !hasApiKey(req) || !(p.startsWith("/api/") || p.startsWith("/mcp"));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String key = req.getHeader("X-Api-Key");
        if (key == null) key = req.getHeader("Authorization").substring(7);
        if (!constantTimeEquals(key, props.apiKey())) {
            reject(res, "invalid API key");
            return;
        }
        Optional<ApiKeyPrincipal> who = resolveOwner();
        if (who.isEmpty()) {
            reject(res, "API key has no account yet: sign in with GitHub once first");
            return;
        }
        var auth = new UsernamePasswordAuthenticationToken(who.get(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
        SecurityContextHolder.getContext().setAuthentication(auth);
        chain.doFilter(req, res);
    }

    private Optional<ApiKeyPrincipal> resolveOwner() {
        var q = keyLogin.isBlank()
                ? jdbc.sql("select id, login from users order by created_at limit 1")
                : jdbc.sql("select id, login from users where login = :l").param("l", keyLogin);
        return q.query((rs, i) -> new ApiKeyPrincipal(rs.getObject("id", UUID.class), rs.getString("login"))).optional();
    }

    private static void reject(HttpServletResponse res, String msg) throws IOException {
        res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":\"" + msg + "\"}");
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
