package io.cistem.api;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.userinfo.DefaultOAuth2UserService;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserRequest;
import org.springframework.security.oauth2.client.userinfo.OAuth2UserService;
import org.springframework.security.oauth2.core.user.DefaultOAuth2User;
import org.springframework.security.oauth2.core.user.OAuth2User;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;
import org.springframework.session.jdbc.config.annotation.web.http.EnableJdbcHttpSession;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Browser users sign in with GitHub and get a session cookie (stored in Postgres so redeploys
 * don't log everyone out). Scripts may instead send the shared API key ({@link ApiKeyFilter}).
 * Public: the SPA itself, {@code /api/share/**}, health.
 */
@Configuration
@EnableWebSecurity
@EnableJdbcHttpSession
public class SecurityConfig {

    public static final String USER_ID_ATTR = "cistem_user_id";

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http, ApiKeyFilter apiKeyFilter, CistemProperties props) throws Exception {
        var csrfHandler = new CsrfTokenRequestAttributeHandler();
        csrfHandler.setCsrfRequestAttributeName(null); // render the token eagerly so the cookie is always set

        http
            .authorizeHttpRequests(a -> a
                .requestMatchers(HttpMethod.GET, "/api/share/**", "/api/me", "/actuator/health/**").permitAll()
                .requestMatchers("/api/**").authenticated()
                .anyRequest().permitAll())           // the SPA and its assets
            .oauth2Login(o -> o
                .userInfoEndpoint(u -> u.userService(githubUserService()))
                .defaultSuccessUrl(props.publicUrl() + "/", true)
                .failureUrl(props.publicUrl() + "/?login=failed"))
            .logout(l -> l
                .logoutUrl("/api/logout")
                .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler())
                .deleteCookies("cistem_session"))
            .csrf(c -> c
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                .csrfTokenRequestHandler(csrfHandler)
                .ignoringRequestMatchers(ApiKeyFilter::hasApiKey))   // non-browser clients carry no cookie, so no CSRF
            .exceptionHandling(e -> e
                .defaultAuthenticationEntryPointFor(
                    (req, res, ex) -> { res.setStatus(HttpServletResponse.SC_UNAUTHORIZED); res.setContentType("application/json"); res.getWriter().write("{\"error\":\"sign in required\"}"); },
                    req -> req.getRequestURI().startsWith("/api/")))
            .addFilterBefore(apiKeyFilter, org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    /** Fetches the GitHub profile, upserts our user row, and exposes our user id on the principal. */
    @Bean
    OAuth2UserService<OAuth2UserRequest, OAuth2User> githubUserService() {
        var delegate = new DefaultOAuth2UserService();
        return request -> {
            OAuth2User gh = delegate.loadUser(request);
            Map<String, Object> a = gh.getAttributes();
            User user = users.upsert("github", String.valueOf(a.get("id")), str(a.get("login")), str(a.get("name")), str(a.get("avatar_url")));
            var attrs = new java.util.HashMap<>(a);
            attrs.put(USER_ID_ATTR, user.id().toString());
            return new DefaultOAuth2User(List.of(new SimpleGrantedAuthority("ROLE_USER")), attrs, "login");
        };
    }

    private final UserRepository users;

    public SecurityConfig(UserRepository users) {
        this.users = users;
    }

    private static String str(Object o) {
        return o == null ? null : o.toString();
    }

    /** Our user id for the current principal, whether it came from OAuth or the API key. */
    public static UUID userId(Object principal) {
        if (principal instanceof OAuth2User u && u.getAttribute(USER_ID_ATTR) != null) return UUID.fromString(u.getAttribute(USER_ID_ATTR));
        if (principal instanceof ApiKeyFilter.ApiKeyPrincipal p) return p.userId();
        throw new IllegalStateException("No cistem user on principal");
    }
}
