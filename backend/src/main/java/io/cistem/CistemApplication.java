package io.cistem;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication(excludeName = {
        // These add their own SecurityFilterChains (form login etc.); McpAuthConfig composes the pieces instead.
        "org.springaicommunity.mcp.security.authorizationserver.boot.McpAuthorizationServerAutoConfiguration",
        "org.springaicommunity.mcp.security.server.boot.McpServerSecurityAutoConfiguration",
        "org.springframework.boot.security.oauth2.server.authorization.autoconfigure.servlet.OAuth2AuthorizationServerAutoConfiguration",
        "org.springframework.boot.security.oauth2.server.authorization.autoconfigure.servlet.OAuth2AuthorizationServerJwtAutoConfiguration"
})
@ConfigurationPropertiesScan
public class CistemApplication {
    public static void main(String[] args) {
        SpringApplication.run(CistemApplication.class, args);
    }
}
