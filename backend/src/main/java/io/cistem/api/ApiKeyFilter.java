package io.cistem.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Single shared key, sent as {@code X-Api-Key} or {@code Authorization: Bearer}.
 * Only {@code /api/**} is protected; {@code /api/share/**} and the actuator stay public.
 * With no key configured (local dev) everything is open.
 */
@Component
public class ApiKeyFilter extends OncePerRequestFilter {

    private final CistemProperties props;

    public ApiKeyFilter(CistemProperties props) {
        this.props = props;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest req) {
        String p = req.getRequestURI();
        return !props.authEnabled()
                || "OPTIONS".equalsIgnoreCase(req.getMethod())
                || !p.startsWith("/api/")
                || p.startsWith("/api/share/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String key = req.getHeader("X-Api-Key");
        if (key == null) {
            String auth = req.getHeader("Authorization");
            if (auth != null && auth.startsWith("Bearer ")) key = auth.substring(7);
        }
        if (key == null || !constantTimeEquals(key, props.apiKey())) {
            res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            res.setContentType("application/json");
            res.getWriter().write("{\"error\":\"missing or invalid API key\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    private static boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    }
}
