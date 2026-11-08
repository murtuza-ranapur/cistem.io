package io.cistem.web;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/** Settings under the {@code cistem.*} prefix. */
@ConfigurationProperties(prefix = "cistem")
public record CistemProperties(String publicUrl, String apiKey, List<String> allowedOrigins) {
    /** An optional shared key for scripts and the MCP server; browser users sign in instead. */
    public boolean apiKeyEnabled() {
        return apiKey != null && !apiKey.isBlank();
    }
}
