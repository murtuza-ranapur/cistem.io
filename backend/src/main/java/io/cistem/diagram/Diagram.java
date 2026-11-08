package io.cistem.diagram;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

/** A stored diagram. {@code document} is the full cistem.io file (see schema/cistem.schema.json). */
public record Diagram(
        UUID id,
        String title,
        String kind,
        JsonNode document,
        int version,
        String shareToken,
        Instant createdAt,
        Instant updatedAt
) {
    /** Listing view: everything except the document body. */
    public record Summary(UUID id, String title, String kind, int version, boolean shared, Instant createdAt, Instant updatedAt) {}

    public Summary summary() {
        return new Summary(id, title, kind, version, shareToken != null, createdAt, updatedAt);
    }

    public Diagram withoutShareToken() {
        return new Diagram(id, title, kind, document, version, null, createdAt, updatedAt);
    }
}
