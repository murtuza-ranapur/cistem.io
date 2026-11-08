package io.cistem.auth;

import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * The cistem user behind the current request, whichever way they authenticated: a browser session (GitHub
 * login), an MCP access token issued by our authorization server (JWT, subject = our user id), or the API key.
 */
@Component
public class CurrentUser {

    private final UserRepository users;

    public CurrentUser(UserRepository users) {
        this.users = users;
    }

    /** The signed-in user's id; throws when nobody is signed in (the security rules make that unreachable for /api). */
    public UUID id() {
        return find().orElseThrow(() -> new IllegalStateException("Not signed in"));
    }

    /** The signed-in user's id, or empty for an anonymous request. */
    public Optional<UUID> find() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || auth instanceof AnonymousAuthenticationToken) return Optional.empty();
        Object p = auth.getPrincipal();
        if (auth instanceof JwtAuthenticationToken jwtAuth) return Optional.of(fromJwt(jwtAuth.getToken()));
        if (p instanceof Jwt jwt) return Optional.of(fromJwt(jwt));
        if (p instanceof OAuth2User || p instanceof ApiKeyFilter.ApiKeyPrincipal) return Optional.of(SecurityConfig.userId(p));
        return Optional.empty();
    }

    private UUID fromJwt(Jwt jwt) {
        // Tokens we mint carry our user id in `sub` (see McpAuthConfig); check it still exists.
        UUID id = UUID.fromString(jwt.getSubject());
        return users.find(id).map(User::id).orElseThrow(() -> new IllegalStateException("Token belongs to an unknown user"));
    }
}
