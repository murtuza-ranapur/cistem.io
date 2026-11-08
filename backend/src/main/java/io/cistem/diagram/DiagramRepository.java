package io.cistem.diagram;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.postgresql.util.PGobject;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class DiagramRepository {

    private final JdbcClient jdbc;
    private final ObjectMapper json;

    public DiagramRepository(JdbcClient jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    private static final String COLUMNS = "id, title, kind, document, version, share_token, created_at, updated_at";

    public List<Diagram.Summary> list(UUID owner) {
        return jdbc.sql("select id, title, kind, version, share_token, created_at, updated_at from diagrams where owner_id = :o order by updated_at desc")
                .param("o", owner)
                .query((rs, i) -> new Diagram.Summary(
                        rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("kind"), rs.getInt("version"),
                        rs.getString("share_token") != null, rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getObject("updated_at", OffsetDateTime.class).toInstant()))
                .list();
    }

    public Optional<Diagram> find(UUID owner, UUID id) {
        return jdbc.sql("select " + COLUMNS + " from diagrams where id = :id and owner_id = :o").param("id", id).param("o", owner).query(this::map).optional();
    }

    public Optional<Diagram> findByShareToken(String token) {
        return jdbc.sql("select " + COLUMNS + " from diagrams where share_token = :t").param("t", token).query(this::map).optional();
    }

    public Diagram insert(UUID owner, String title, String kind, JsonNode document) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into diagrams (id, owner_id, title, kind, document) values (:id, :o, :title, :kind, :doc)")
                .param("id", id).param("o", owner).param("title", title).param("kind", kind).param("doc", jsonb(document))
                .update();
        return find(owner, id).orElseThrow();
    }

    /** Optimistic update: succeeds only if the stored version equals {@code expectedVersion}. */
    public Optional<Diagram> update(UUID owner, UUID id, int expectedVersion, String title, JsonNode document) {
        int n = jdbc.sql("""
                update diagrams set title = :title, document = :doc, version = version + 1, updated_at = now()
                where id = :id and owner_id = :o and version = :v""")
                .param("title", title).param("doc", jsonb(document)).param("id", id).param("o", owner).param("v", expectedVersion)
                .update();
        return n == 1 ? find(owner, id) : Optional.empty();
    }

    public boolean delete(UUID owner, UUID id) {
        return jdbc.sql("delete from diagrams where id = :id and owner_id = :o").param("id", id).param("o", owner).update() == 1;
    }

    public Optional<Diagram> setShareToken(UUID owner, UUID id, String token) {
        jdbc.sql("update diagrams set share_token = :t where id = :id and owner_id = :o").param("t", token).param("id", id).param("o", owner).update();
        return find(owner, id);
    }

    private Diagram map(ResultSet rs, int i) throws SQLException {
        try {
            return new Diagram(
                    rs.getObject("id", UUID.class), rs.getString("title"), rs.getString("kind"),
                    json.readTree(rs.getString("document")), rs.getInt("version"), rs.getString("share_token"),
                    rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getObject("updated_at", OffsetDateTime.class).toInstant());
        } catch (tools.jackson.core.JacksonException e) {
            throw new SQLException("Corrupt document for diagram " + rs.getString("id"), e);
        }
    }

    private PGobject jsonb(JsonNode node) {
        try {
            PGobject o = new PGobject();
            o.setType("jsonb");
            o.setValue(json.writeValueAsString(node));
            return o;
        } catch (SQLException | tools.jackson.core.JacksonException e) {
            throw new IllegalArgumentException("Document is not serialisable", e);
        }
    }
}
