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

    private static final String COLUMNS = "id, project_id, title, kind, document, version, share_token, created_at, updated_at";
    private static final String SUMMARY_COLUMNS = "id, project_id, title, kind, version, share_token, created_at, updated_at";

    /** The owner's diagrams, newest-updated first; only those in {@code project} when it isn't null. */
    public List<Diagram.Summary> list(UUID owner, UUID project) {
        String inProject = project == null ? "" : " and project_id = :p";
        var query = jdbc.sql("select " + SUMMARY_COLUMNS + " from diagrams where owner_id = :o" + inProject + " order by updated_at desc").param("o", owner);
        if (project != null) query = query.param("p", project);
        return query.query(DiagramRepository::summary).list();
    }

    /** Every diagram in a project, with documents, newest-updated first (for a shared project). */
    public List<Diagram> listInProject(UUID project) {
        return jdbc.sql("select " + COLUMNS + " from diagrams where project_id = :p order by updated_at desc").param("p", project).query(this::map).list();
    }

    public Optional<Diagram> find(UUID owner, UUID id) {
        return jdbc.sql("select " + COLUMNS + " from diagrams where id = :id and owner_id = :o").param("id", id).param("o", owner).query(this::map).optional();
    }

    public Optional<Diagram> findByShareToken(String token) {
        return jdbc.sql("select " + COLUMNS + " from diagrams where share_token = :t").param("t", token).query(this::map).optional();
    }

    public Diagram insert(UUID owner, UUID project, String title, String kind, JsonNode document) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into diagrams (id, owner_id, project_id, title, kind, document) values (:id, :o, :p, :title, :kind, :doc)")
                .param("id", id).param("o", owner).param("p", project).param("title", title).param("kind", kind).param("doc", jsonb(document))
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

    /** Put the diagram in another project; its version, document and updated_at stay as they are. */
    public boolean move(UUID owner, UUID id, UUID project) {
        return jdbc.sql("update diagrams set project_id = :p where id = :id and owner_id = :o").param("p", project).param("id", id).param("o", owner).update() == 1;
    }

    public Optional<Diagram> setShareToken(UUID owner, UUID id, String token) {
        jdbc.sql("update diagrams set share_token = :t where id = :id and owner_id = :o").param("t", token).param("id", id).param("o", owner).update();
        return find(owner, id);
    }

    private Diagram map(ResultSet rs, int i) throws SQLException {
        try {
            return new Diagram(
                    rs.getObject("id", UUID.class), rs.getObject("project_id", UUID.class), rs.getString("title"), rs.getString("kind"),
                    json.readTree(rs.getString("document")), rs.getInt("version"), rs.getString("share_token"),
                    rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getObject("updated_at", OffsetDateTime.class).toInstant());
        } catch (tools.jackson.core.JacksonException e) {
            throw new SQLException("Corrupt document for diagram " + rs.getString("id"), e);
        }
    }

    private static Diagram.Summary summary(ResultSet rs, int i) throws SQLException {
        return new Diagram.Summary(
                rs.getObject("id", UUID.class), rs.getObject("project_id", UUID.class), rs.getString("title"), rs.getString("kind"), rs.getInt("version"),
                rs.getString("share_token") != null, rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getObject("updated_at", OffsetDateTime.class).toInstant());
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
