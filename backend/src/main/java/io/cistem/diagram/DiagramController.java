package io.cistem.diagram;

import io.cistem.auth.CurrentUser;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The browser's API over the signed-in user's diagrams. The ETag is the version: send it back as
 * {@code If-Match} when saving, and a stale save gets 409 with the current diagram so the client can merge.
 */
@RestController
@RequestMapping("/api")
public class DiagramController {

    private final DiagramService diagrams;
    private final CurrentUser user;

    public DiagramController(DiagramService diagrams, CurrentUser user) {
        this.diagrams = diagrams;
        this.user = user;
    }

    /** Request body for create/update: the full diagram file (title and kind are read from it). */
    public record DiagramBody(@NotNull JsonNode document, Integer version) {}

    @GetMapping("/diagrams")
    public List<Diagram.Summary> list() {
        return diagrams.list(user.id());
    }

    @PostMapping("/diagrams")
    public ResponseEntity<Diagram> create(@RequestBody DiagramBody body) {
        return withEtag(HttpStatus.CREATED, diagrams.create(user.id(), body.document()));
    }

    @GetMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> get(@PathVariable UUID id) {
        return withEtag(HttpStatus.OK, diagrams.get(user.id(), id));
    }

    /** Replace the document from the version in If-Match, else the body's version; with neither, last write wins. */
    @PutMapping("/diagrams/{id}")
    public ResponseEntity<Diagram> update(@PathVariable UUID id, @RequestHeader(value = "If-Match", required = false) String ifMatch,
                                          @RequestBody DiagramBody body) {
        Integer expected = ifMatch != null ? Integer.valueOf(parseVersion(ifMatch)) : body.version();
        return withEtag(HttpStatus.OK, diagrams.update(user.id(), id, expected, body.document()));
    }

    @DeleteMapping("/diagrams/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        diagrams.delete(user.id(), id);
    }

    @PostMapping("/diagrams/{id}/share")
    public Diagram share(@PathVariable UUID id) {
        return diagrams.share(user.id(), id);
    }

    @DeleteMapping("/diagrams/{id}/share")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unshare(@PathVariable UUID id) {
        diagrams.unshare(user.id(), id);
    }

    /** Public and read-only (permitted in SecurityConfig). */
    @GetMapping("/share/{token}")
    public Diagram shared(@PathVariable String token) {
        return diagrams.shared(token).orElseThrow(() -> new DiagramService.NotFound("No such diagram"));
    }

    // ---------- errors ----------

    @ExceptionHandler(DiagramService.NotFound.class)
    ResponseEntity<Map<String, String>> notFound(DiagramService.NotFound e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "No such diagram"));
    }

    @ExceptionHandler(DiagramService.Conflict.class)
    ResponseEntity<Diagram> conflict(DiagramService.Conflict e) {
        return withEtag(HttpStatus.CONFLICT, e.current);
    }

    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    }

    private static ResponseEntity<Diagram> withEtag(HttpStatus status, Diagram d) {
        return ResponseEntity.status(status).eTag("\"" + d.version() + "\"").body(d);
    }

    private static int parseVersion(String ifMatch) {
        try {
            return Integer.parseInt(ifMatch.replace("W/", "").replace("\"", "").trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("If-Match must be the ETag of the version you are editing");
        }
    }
}
