package io.cistem.diagram;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

/**
 * A stored diagram. {@code document} is the full cistem.dev file (see schema/cistem.schema.json); {@code projectId}
 * is the project it belongs to (every diagram is in exactly one).
 */
public record Diagram(
        UUID id,
        UUID projectId,
        String title,
        String kind,
        JsonNode document,
        int version,
        String shareToken,
        Instant createdAt,
        Instant updatedAt
) {
    /** Listing view: everything except the document body. */
    public record Summary(UUID id, UUID projectId, String title, String kind, int version, boolean shared, Instant createdAt, Instant updatedAt) {}

    public Summary summary() {
        return new Summary(id, projectId, title, kind, version, shareToken != null, createdAt, updatedAt);
    }

    public Diagram withoutShareToken() {
        return new Diagram(id, projectId, title, kind, document, version, null, createdAt, updatedAt);
    }
}
