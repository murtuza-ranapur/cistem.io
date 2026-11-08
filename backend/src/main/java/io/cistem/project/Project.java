package io.cistem.project;

import io.cistem.diagram.Diagram;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A named group of the owner's diagrams. Every diagram is in exactly one project, and every account has at least
 * one. {@code shareToken} is only ever handed to the owner; {@code diagrams} are summaries, newest-updated first.
 */
public record Project(
        UUID id,
        String title,
        boolean shared,
        String shareToken,
        Instant createdAt,
        Instant updatedAt,
        List<Diagram.Summary> diagrams
) {
    public Project withDiagrams(List<Diagram.Summary> diagrams) {
        return new Project(id, title, shared, shareToken, createdAt, updatedAt, List.copyOf(diagrams));
    }

    /** What anyone with a project's share link sees: its title and every diagram in full, without share tokens. */
    public record Shared(String title, List<Diagram> diagrams) {}
}
