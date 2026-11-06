package io.cistem.api;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@Repository
public class UserRepository {

    private final JdbcClient jdbc;

    public UserRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** Insert on first login, refresh profile fields on later ones. */
    public User upsert(String provider, String providerId, String login, String name, String avatarUrl) {
        return jdbc.sql("""
                insert into users (id, provider, provider_id, login, name, avatar_url)
                values (:id, :provider, :pid, :login, :name, :avatar)
                on conflict (provider, provider_id) do update
                   set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, last_seen = now()
                returning id, provider, provider_id, login, name, avatar_url, created_at""")
                .param("id", UUID.randomUUID()).param("provider", provider).param("pid", providerId)
                .param("login", login).param("name", name).param("avatar", avatarUrl)
                .query((rs, i) -> new User(rs.getObject("id", UUID.class), rs.getString("provider"), rs.getString("provider_id"),
                        rs.getString("login"), rs.getString("name"), rs.getString("avatar_url"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()))
                .single();
    }

    public Optional<User> find(UUID id) {
        return jdbc.sql("select id, provider, provider_id, login, name, avatar_url, created_at from users where id = :id")
                .param("id", id)
                .query((rs, i) -> new User(rs.getObject("id", UUID.class), rs.getString("provider"), rs.getString("provider_id"),
                        rs.getString("login"), rs.getString("name"), rs.getString("avatar_url"),
                        rs.getObject("created_at", OffsetDateTime.class).toInstant()))
                .optional();
    }
}
