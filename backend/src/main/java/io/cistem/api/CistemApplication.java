package io.cistem.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class CistemApplication {
    public static void main(String[] args) {
        SpringApplication.run(CistemApplication.class, args);
    }
}
