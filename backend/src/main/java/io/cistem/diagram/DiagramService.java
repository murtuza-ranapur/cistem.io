package io.cistem.diagram;

import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * A user's diagrams: the rules shared by the HTTP API and the MCP tools. Every operation is scoped to the owner;
 * updates are optimistic (they name the version they started from), so an edit racing another one fails loudly
 * instead of overwriting it.
 */
@Service
public class DiagramService {

    /** Thrown when no diagram with that id belongs to the user. */
    public static class NotFound extends RuntimeException {
        public NotFound(String message) { super(message); }
    }
    /** Thrown when the diagram changed since the version the caller started from. */
    public static class Conflict extends RuntimeException {
        public final Diagram current;
        public Conflict(Diagram current) { super("The diagram changed while editing; read it again and retry"); this.current = current; }
    }

    private static final SecureRandom RANDOM = new SecureRandom();
    private final DiagramRepository repo;

    public DiagramService(DiagramRepository repo) {
        this.repo = repo;
    }

    public List<Diagram.Summary> list(UUID owner) {
        return repo.list(owner);
    }

    public Diagram get(UUID owner, UUID id) {
        return repo.find(owner, id).orElseThrow(() -> new NotFound("No such diagram: " + id));
    }

    /** Store a new diagram; title and kind come from the file. */
    public Diagram create(UUID owner, JsonNode document) {
        DiagramFiles.validate(document);
        return repo.insert(owner, DiagramFiles.title(document), DiagramFiles.kind(document), document);
    }

    /** Replace the document, if it's still at `expectedVersion` (null: whatever version it's at now). */
    public Diagram update(UUID owner, UUID id, Integer expectedVersion, JsonNode document) {
        DiagramFiles.validate(document);
        Diagram current = get(owner, id);
        int expected = expectedVersion != null ? expectedVersion : current.version();
        return repo.update(owner, id, expected, DiagramFiles.title(document), document).orElseThrow(() -> new Conflict(current));
    }

    /**
     * Read, change and save a diagram in one go: `change` gets the document brought up to the current file version,
     * of the required kind (null: any). Returns what was saved.
     */
    public Saved edit(UUID owner, UUID id, String requiredKind, Consumer<ObjectNode> change) {
        Diagram d = get(owner, id);
        ObjectNode file = DiagramFiles.normalise((ObjectNode) d.document().deepCopy());
        if (requiredKind != null) DiagramFiles.requireKind(file, requiredKind);
        change.accept(file);
        DiagramFiles.touch(file);
        Diagram saved = repo.update(owner, id, d.version(), DiagramFiles.title(file), file).orElseThrow(() -> new Conflict(d));
        return new Saved(saved, file);
    }
    /** A saved diagram with its document as written. */
    public record Saved(Diagram diagram, ObjectNode file) {}

    /** The document, brought up to the current file version (a copy: changing it changes nothing stored). */
    public ObjectNode read(UUID owner, UUID id, String requiredKind) {
        ObjectNode file = DiagramFiles.normalise((ObjectNode) get(owner, id).document().deepCopy());
        if (requiredKind != null) DiagramFiles.requireKind(file, requiredKind);
        return file;
    }

    public void delete(UUID owner, UUID id) {
        if (!repo.delete(owner, id)) throw new NotFound("No such diagram: " + id);
    }

    /** Create (or rotate) a read-only share link. */
    public Diagram share(UUID owner, UUID id) {
        get(owner, id);
        byte[] b = new byte[18];
        RANDOM.nextBytes(b);
        return repo.setShareToken(owner, id, Base64.getUrlEncoder().withoutPadding().encodeToString(b)).orElseThrow();
    }

    public void unshare(UUID owner, UUID id) {
        get(owner, id);
        repo.setShareToken(owner, id, null);
    }

    /** A shared diagram, for anyone with the link; the token itself isn't handed back. */
    public Optional<Diagram> shared(String token) {
        return repo.findByShareToken(token).map(Diagram::withoutShareToken);
    }
}
