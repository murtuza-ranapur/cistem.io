package io.cistem.mcp;

import io.cistem.api.ApiKeyFilter;
import io.cistem.api.SecurityConfig;
import io.cistem.api.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Resolves the cistem user behind the current request, whichever way they authenticated:
 * a browser session (GitHub login), an MCP access token issued by our authorization server
 * (JWT, subject = our user id), or the shared API key.
 */
@Component
public class CurrentUser {

    private final UserRepository users;

    public CurrentUser(UserRepository users) {
        this.users = users;
    }

    public UUID id() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated()) throw new IllegalStateException("Not signed in");
        Object p = auth.getPrincipal();
        if (auth instanceof JwtAuthenticationToken jwtAuth) return fromJwt(jwtAuth.getToken());
        if (p instanceof Jwt jwt) return fromJwt(jwt);
        if (p instanceof OAuth2User || p instanceof ApiKeyFilter.ApiKeyPrincipal) return SecurityConfig.userId(p);
        throw new IllegalStateException("Unsupported principal " + p.getClass().getSimpleName());
    }

    private UUID fromJwt(Jwt jwt) {
        // Tokens we mint carry our user id in `sub` (see McpAuthConfig); verify it still exists.
        UUID id = UUID.fromString(jwt.getSubject());
        return users.find(id).map(u -> u.id()).orElseThrow(() -> new IllegalStateException("Token belongs to an unknown user"));
    }
}
