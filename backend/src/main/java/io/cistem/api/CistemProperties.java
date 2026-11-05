package io.cistem.api;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/** Settings under the {@code cistem.*} prefix. */
@ConfigurationProperties(prefix = "cistem")
public record CistemProperties(String apiKey, List<String> allowedOrigins) {
    public boolean authEnabled() {
        return apiKey != null && !apiKey.isBlank();
    }
}
