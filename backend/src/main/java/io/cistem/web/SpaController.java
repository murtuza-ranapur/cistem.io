package io.cistem.web;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves the built frontend (copied into classpath:/static by the Dockerfile).
 * Hashed assets under /assets are served by Spring's static handler with long caching;
 * everything that isn't /api or an asset falls through to index.html, uncached.
 */
@RestController
public class SpaController {

    private final Resource index = new ClassPathResource("static/index.html");

    @GetMapping(value = { "/", "/{path:^(?!api$|assets$|actuator$)[^.]*}" }, produces = MediaType.TEXT_HTML_VALUE)
    public ResponseEntity<Resource> index() {
        if (!index.exists()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(index);
    }
}
