package io.cistem.api;

import tools.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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

    public DiagramController(DiagramRepository repo) {
        this.repo = repo;
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
    public List<Diagram.Summary> list() {
        return repo.list();
    }

    @PostMapping("/diagrams")
    @ResponseStatus(HttpStatus.CREATED)
    public ResponseEntity<Diagram> create(@RequestBody DiagramBody body) {
        body.validate();
        Diagram d = repo.insert(body.title(), body.kind(), body.document());
        return ResponseEntity.status(HttpStatus.CREATED).eTag(etag(d)).body(d);
    }

    @GetMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> get(@PathVariable UUID id) {
        Diagram d = repo.find(id).orElseThrow(DiagramController::notFound);
        return ResponseEntity.ok().eTag(etag(d)).body(d);
    }

    /**
     * Replace the document. Send {@code If-Match: "<version>"} (the ETag from the last GET/PUT);
     * a stale version gets 409 with the current diagram so the client can merge.
     */
    @PutMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> update(@PathVariable UUID id,
                                          @RequestHeader(value = "If-Match", required = false) String ifMatch,
                                          @RequestBody DiagramBody body) {
        body.validate();
        Diagram current = repo.find(id).orElseThrow(DiagramController::notFound);
        int expected = ifMatch == null ? current.version() : parseVersion(ifMatch);
        return repo.update(id, expected, body.title(), body.document())
                .map(d -> ResponseEntity.ok().eTag(etag(d)).body(d))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.CONFLICT).eTag(etag(current)).body(current));
    }

    @DeleteMapping("/diagrams/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        if (!repo.delete(id)) throw notFound();
    }

    /** Create (or rotate) a read-only share link. */
    @PostMapping("/diagrams/{id}/share")
    public Diagram.Summary share(@PathVariable UUID id) {
        repo.find(id).orElseThrow(DiagramController::notFound);
        byte[] b = new byte[18];
        RANDOM.nextBytes(b);
        return repo.setShareToken(id, Base64.getUrlEncoder().withoutPadding().encodeToString(b)).orElseThrow().summary();
    }

    @DeleteMapping("/diagrams/{id}/share")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unshare(@PathVariable UUID id) {
        repo.find(id).orElseThrow(DiagramController::notFound);
        repo.setShareToken(id, null);
    }

    /** Public, read-only. Not behind the API key (see {@link ApiKeyFilter}). */
    @GetMapping("/share/{token}")
    public Diagram shared(@PathVariable String token) {
        return repo.findByShareToken(token).orElseThrow(DiagramController::notFound);
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
