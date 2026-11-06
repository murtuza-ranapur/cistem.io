package io.cistem.api;

import tools.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class DiagramController {

    private static final SecureRandom RANDOM = new SecureRandom();
    private final DiagramRepository repo;
    private final UserRepository users;

    public DiagramController(DiagramRepository repo, UserRepository users) {
        this.repo = repo;
        this.users = users;
    }

    /** Who am I: 200 with the profile, or 401 (handled by security) when signed out. */
    @GetMapping("/me")
    public ResponseEntity<User.Profile> me(@AuthenticationPrincipal Object principal) {
        if (principal == null || "anonymousUser".equals(principal)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        return users.find(SecurityConfig.userId(principal)).map(u -> ResponseEntity.ok(u.profile()))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }

    /** Request body for create/update: the full diagram file. Title and kind are read from it. */
    public record DiagramBody(@NotNull JsonNode document) {
        String title() {
            JsonNode t = document.path("meta").path("title");
            return t.isTextual() && !t.asText().isBlank() ? t.asText() : "Untitled";
        }
        String kind() {
            JsonNode k = document.path("kind");
            return k.isTextual() ? k.asText() : "system";
        }
        void validate() {
            if (!document.isObject()) throw bad("document must be a JSON object");
            if (!document.path("version").isInt()) throw bad("document.version is required");
            if (!document.path("kind").isTextual()) throw bad("document.kind is required");
            if (!document.path("model").isObject()) throw bad("document.model is required");
        }
    }

    @GetMapping("/diagrams")
    public List<Diagram.Summary> list(@AuthenticationPrincipal Object p) {
        return repo.list(SecurityConfig.userId(p));
    }

    @PostMapping("/diagrams")
    @ResponseStatus(HttpStatus.CREATED)
    public ResponseEntity<Diagram> create(@AuthenticationPrincipal Object p, @RequestBody DiagramBody body) {
        body.validate();
        Diagram d = repo.insert(SecurityConfig.userId(p), body.title(), body.kind(), body.document());
        return ResponseEntity.status(HttpStatus.CREATED).eTag(etag(d)).body(d);
    }

    @GetMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> get(@AuthenticationPrincipal Object p, @PathVariable UUID id) {
        Diagram d = repo.find(SecurityConfig.userId(p), id).orElseThrow(DiagramController::notFound);
        return ResponseEntity.ok().eTag(etag(d)).body(d);
    }

    /**
     * Replace the document. Send {@code If-Match: "<version>"} (the ETag from the last GET/PUT);
     * a stale version gets 409 with the current diagram so the client can merge.
     */
    @PutMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> update(@AuthenticationPrincipal Object p, @PathVariable UUID id,
                                          @RequestHeader(value = "If-Match", required = false) String ifMatch,
                                          @RequestBody DiagramBody body) {
        body.validate();
        UUID owner = SecurityConfig.userId(p);
        Diagram current = repo.find(owner, id).orElseThrow(DiagramController::notFound);
        int expected = ifMatch == null ? current.version() : parseVersion(ifMatch);
        return repo.update(owner, id, expected, body.title(), body.document())
                .map(d -> ResponseEntity.ok().eTag(etag(d)).body(d))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.CONFLICT).eTag(etag(current)).body(current));
    }

    @DeleteMapping("/diagrams/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Object p, @PathVariable UUID id) {
        if (!repo.delete(SecurityConfig.userId(p), id)) throw notFound();
    }

    /** Create (or rotate) a read-only share link. */
    @PostMapping("/diagrams/{id}/share")
    public Diagram share(@AuthenticationPrincipal Object p, @PathVariable UUID id) {
        UUID owner = SecurityConfig.userId(p);
        repo.find(owner, id).orElseThrow(DiagramController::notFound);
        byte[] b = new byte[18];
        RANDOM.nextBytes(b);
        return repo.setShareToken(owner, id, Base64.getUrlEncoder().withoutPadding().encodeToString(b)).orElseThrow();
    }

    @DeleteMapping("/diagrams/{id}/share")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unshare(@AuthenticationPrincipal Object p, @PathVariable UUID id) {
        UUID owner = SecurityConfig.userId(p);
        repo.find(owner, id).orElseThrow(DiagramController::notFound);
        repo.setShareToken(owner, id, null);
    }

    /** Public, read-only (permitted in {@link SecurityConfig}). The share token is stripped from the response. */
    @GetMapping("/share/{token}")
    public Diagram shared(@PathVariable String token) {
        Diagram d = repo.findByShareToken(token).orElseThrow(DiagramController::notFound);
        return new Diagram(d.id(), d.title(), d.kind(), d.document(), d.version(), null, d.createdAt(), d.updatedAt());
    }

    private static String etag(Diagram d) {
        return "\"" + d.version() + "\"";
    }

    private static int parseVersion(String ifMatch) {
        try {
            return Integer.parseInt(ifMatch.replace("W/", "").replace("\"", "").trim());
        } catch (NumberFormatException e) {
            throw bad("If-Match must be the ETag of the version you are editing");
        }
    }

    private static ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "No such diagram");
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }
}
