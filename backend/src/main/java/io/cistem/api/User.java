package io.cistem.api;

import java.time.Instant;
import java.util.UUID;

public record User(UUID id, String provider, String providerId, String login, String name, String avatarUrl, Instant createdAt) {
    /** What the browser gets from /api/me. */
    public record Profile(UUID id, String login, String name, String avatarUrl) {}

    public Profile profile() {
        return new Profile(id, login, name, avatarUrl);
    }
}
