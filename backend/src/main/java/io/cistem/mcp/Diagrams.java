package io.cistem.mcp;

import io.cistem.auth.CurrentUser;
import io.cistem.diagram.Diagram;
import io.cistem.diagram.DiagramService;
import io.cistem.engine.Engine;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.UUID;
import java.util.function.Consumer;

/** The signed-in user's diagrams, as the MCP tools use them: by id string, with errors worded for an agent. */
@Component
public class Diagrams {

    /** How the create tools describe their optional projectId. */
    static final String PROJECT_PARAM = "Project (id) to put it in; omit for the user's default project";

    private final DiagramService service;
    private final CurrentUser user;
    private final ObjectMapper om;

    public Diagrams(DiagramService service, CurrentUser user, ObjectMapper om) {
        this.service = service;
        this.user = user;
        this.om = om;
    }

    public DiagramService service() { return service; }
    public UUID owner() { return user.id(); }

    public Diagram load(String id) {
        return service.get(owner(), uuid(id));
    }

    /** The document at the current file version; `kind` (null: any) is required. */
    public ObjectNode read(String id, String kind) {
        return service.read(owner(), uuid(id), kind);
    }

    /** Store a new diagram in the project named by id (null or blank: the user's default project). */
    public Diagram insert(JsonNode file, String projectId) {
        return service.create(owner(), optionalUuid(projectId, "project"), file);
    }

    /** Read-modify-write a diagram of `kind`, with optimistic concurrency. */
    public DiagramService.Saved edit(String id, String kind, Consumer<ObjectNode> change) {
        return service.edit(owner(), uuid(id), kind, change);
    }

    /** Edit a system diagram and answer with its new version and evaluation, so the agent sees the effect. */
    public ObjectNode editSystem(String id, Consumer<ObjectNode> change) {
        DiagramService.Saved s = edit(id, "system", change);
        ObjectNode out = savedResult(s.diagram());
        out.set("evaluation", Engine.report(s.file(), Engine.compute(s.file().path("model")), om));
        return out;
    }

    /** {diagramId, version}: what every tool that saves answers with (plus its own fields). */
    public ObjectNode savedResult(Diagram d) {
        ObjectNode out = om.createObjectNode();
        out.put("diagramId", d.id().toString()).put("version", d.version());
        return out;
    }

    public static UUID uuid(String s) {
        return uuid(s, "diagram");
    }

    /** Parse an id; `what` ("diagram", "project") words the error. */
    public static UUID uuid(String s, String what) {
        try { return UUID.fromString(s); } catch (IllegalArgumentException | NullPointerException e) { throw new IllegalArgumentException("Not a " + what + " id: " + s); }
    }

    /** As {@link #uuid(String, String)}, but null or blank means none. */
    public static UUID optionalUuid(String s, String what) {
        return s == null || s.isBlank() ? null : uuid(s, what);
    }
}
