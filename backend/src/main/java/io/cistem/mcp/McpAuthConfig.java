package io.cistem.mcp;

import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.source.ImmutableJWKSet;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import io.cistem.api.ApiKeyFilter;
import io.cistem.api.CistemProperties;
import io.cistem.api.SecurityConfig;
import org.springaicommunity.mcp.security.authorizationserver.config.McpAuthorizationServerConfigurer;
import org.springaicommunity.mcp.security.server.config.McpServerOAuth2Configurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.oauth2.server.authorization.OAuth2AuthorizationServerConfigurer;
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.JdbcOAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationConsentService;
import org.springframework.security.oauth2.server.authorization.OAuth2AuthorizationService;
import org.springframework.security.oauth2.server.authorization.OAuth2TokenType;
import org.springframework.security.oauth2.server.authorization.client.JdbcRegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClientRepository;
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient;
import org.springframework.security.oauth2.server.authorization.settings.TokenSettings;
import org.springframework.security.oauth2.core.ClientAuthenticationMethod;
import java.time.Duration;
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings;
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext;
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.util.matcher.MediaTypeRequestMatcher;
import org.springframework.http.MediaType;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.List;
import java.util.UUID;

/**
 * OAuth 2.1 for MCP clients, with cistem itself as the authorization server.
 *
 * Flow: a client (claude.ai, Claude Code, Inspector) hits /mcp, gets 401 + resource metadata,
 * discovers /.well-known/oauth-authorization-server, registers itself (DCR), and sends the user
 * to /oauth2/authorize. If the user isn't signed in they go through the normal GitHub login
 * first; then a code is issued and exchanged for a JWT whose subject is our user id.
 * Tokens, codes and registered clients live in Postgres; the signing key too.
 */
@Configuration
public class McpAuthConfig {

    public static final String MCP_PATH = "/mcp";

    /** Authorization-server endpoints: /oauth2/authorize, /oauth2/token, /oauth2/register, /oauth2/jwks, /.well-known/... */
    @Bean
    @Order(1)
    SecurityFilterChain authorizationServerChain(HttpSecurity http) throws Exception {
        // Explicit paths rather than getEndpointsMatcher(): the MCP configurer adds the registration
        // endpoint during init, after a matcher captured up front would have been computed.
        // (/oauth2/authorization/** and /login/oauth2/** are the GitHub *login* and stay on the app chain.)
        http
            .securityMatcher("/oauth2/authorize", "/oauth2/token", "/oauth2/jwks", "/oauth2/revoke", "/oauth2/introspect",
                             "/oauth2/register", "/oauth2/device_authorization", "/oauth2/device_verification",
                             "/connect/logout", "/userinfo", "/.well-known/oauth-authorization-server", "/.well-known/openid-configuration")
            .with(McpAuthorizationServerConfigurer.mcpAuthorizationServer(), mcp -> mcp
                .dynamicClientRegistration(true)
                .authorizationServer(a -> a.oidc(oidc -> {})))   // OIDC discovery doc too; some clients probe it
            .authorizeHttpRequests(a -> a
                // machine endpoints authenticate themselves (client auth, PKCE) or are public metadata
                .requestMatchers("/oauth2/register", "/oauth2/token", "/oauth2/jwks", "/oauth2/introspect", "/oauth2/revoke", "/.well-known/**").permitAll()
                .anyRequest().authenticated())   // /oauth2/authorize needs the signed-in user
            // A browser arriving at /oauth2/authorize without a session goes through GitHub first,
            // then comes back here (saved request). Non-browser calls get a plain 401.
            .exceptionHandling(e -> e
                .defaultAuthenticationEntryPointFor(new LoginUrlAuthenticationEntryPoint("/oauth2/authorization/github"), new MediaTypeRequestMatcher(MediaType.TEXT_HTML))
                .defaultAuthenticationEntryPointFor(new org.springframework.security.web.authentication.HttpStatusEntryPoint(org.springframework.http.HttpStatus.UNAUTHORIZED), r -> true));
        return http.build();
    }

    /** The MCP endpoint itself: bearer JWTs from our own authorization server, or the shared API key. */
    @Bean
    @Order(2)
    SecurityFilterChain mcpChain(HttpSecurity http, CistemProperties props, JwtDecoder jwtDecoder, ApiKeyFilter apiKeyFilter) throws Exception {
        http
            .securityMatcher(MCP_PATH, MCP_PATH + "/**", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/**")
            .authorizeHttpRequests(a -> a
                .requestMatchers("/.well-known/**").permitAll()
                .anyRequest().authenticated())
            .with(McpServerOAuth2Configurer.mcpServerOAuth2(), mcp -> mcp
                .authorizationServer(props.publicUrl())
                .resourcePath(MCP_PATH)
                .resourceName("cistem.io")
                .validateAudienceClaim(true)
                .jwtDecoder(jwtDecoder))
            .csrf(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS))
            .addFilterBefore(apiKeyFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    AuthorizationServerSettings authorizationServerSettings(CistemProperties props) {
        return AuthorizationServerSettings.builder().issuer(props.publicUrl()).build();
    }

    /**
     * Dynamically registered clients would otherwise get Spring's defaults: 5-minute access tokens, and
     * public (PKCE-only) clients get no refresh token at all — so Claude's connector "signed out" every few
     * minutes. Every client, including ones registered before this change, is served with our token policy.
     */
    @Bean
    RegisteredClientRepository registeredClientRepository(JdbcTemplate jdbc) {
        JdbcRegisteredClientRepository jdbcRepo = new JdbcRegisteredClientRepository(jdbc);
        return new RegisteredClientRepository() {
            @Override public void save(RegisteredClient c) { jdbcRepo.save(withTokenPolicy(c)); }
            @Override public RegisteredClient findById(String id) { return withTokenPolicy(jdbcRepo.findById(id)); }
            @Override public RegisteredClient findByClientId(String id) { return withTokenPolicy(jdbcRepo.findByClientId(id)); }
        };
    }

    /** Public clients can't refresh, so their access token lives as long as a browser session; others refresh. */
    static final Duration PUBLIC_ACCESS_TTL = Duration.ofDays(30);
    static final Duration ACCESS_TTL = Duration.ofHours(1);
    static final Duration REFRESH_TTL = Duration.ofDays(90);

    static RegisteredClient withTokenPolicy(RegisteredClient c) {
        if (c == null) return null;
        var methods = c.getClientAuthenticationMethods();
        boolean publicClient = methods.isEmpty() || (methods.size() == 1 && methods.contains(ClientAuthenticationMethod.NONE));
        TokenSettings ts = TokenSettings.withSettings(c.getTokenSettings().getSettings())
                .accessTokenTimeToLive(publicClient ? PUBLIC_ACCESS_TTL : ACCESS_TTL)
                .refreshTokenTimeToLive(REFRESH_TTL)
                .build();
        return RegisteredClient.from(c).tokenSettings(ts).build();
    }

    @Bean
    OAuth2AuthorizationService authorizationService(JdbcTemplate jdbc, RegisteredClientRepository clients) {
        return new JdbcOAuth2AuthorizationService(jdbc, clients);
    }

    @Bean
    OAuth2AuthorizationConsentService authorizationConsentService(JdbcTemplate jdbc, RegisteredClientRepository clients) {
        return new JdbcOAuth2AuthorizationConsentService(jdbc, clients);
    }

    /** Put our user id in `sub` so the resource side never has to trust a mutable GitHub login. */
    @Bean
    OAuth2TokenCustomizer<JwtEncodingContext> userIdSubject() {
        return ctx -> {
            if (!OAuth2TokenType.ACCESS_TOKEN.equals(ctx.getTokenType()) && !OidcParameterNames.ID_TOKEN.equals(ctx.getTokenType().getValue())) return;
            Object principal = ctx.getPrincipal().getPrincipal();
            if (principal instanceof OAuth2User u && u.getAttribute(SecurityConfig.USER_ID_ATTR) != null) {
                ctx.getClaims().subject(u.getAttribute(SecurityConfig.USER_ID_ATTR));
                ctx.getClaims().claim("login", u.getName());
            }
        };
    }

    /** RSA signing key, generated once and kept in Postgres. */
    @Bean
    JWKSource<SecurityContext> jwkSource(JdbcClient jdbc) throws Exception {
        List<String> stored = jdbc.sql("select jwk from signing_keys order by created_at desc limit 1").query(String.class).list();
        RSAKey key;
        if (stored.isEmpty()) {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            KeyPair kp = g.generateKeyPair();
            key = new RSAKey.Builder((RSAPublicKey) kp.getPublic()).privateKey((RSAPrivateKey) kp.getPrivate()).keyID(UUID.randomUUID().toString()).build();
            jdbc.sql("insert into signing_keys (id, jwk) values (:id, :jwk)").param("id", key.getKeyID()).param("jwk", key.toJSONString()).update();
        } else {
            key = RSAKey.parse(stored.get(0));
        }
        return new ImmutableJWKSet<>(new JWKSet(key));
    }

    @Bean
    JwtDecoder jwtDecoder(JWKSource<SecurityContext> jwkSource) {
        var processor = new DefaultJWTProcessor<SecurityContext>();
        processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, jwkSource));
        processor.setJWTClaimsSetVerifier((claims, ctx) -> {}); // Spring's decoder applies its own validators (exp, nbf, issuer)
        return new NimbusJwtDecoder(processor);
    }
}
