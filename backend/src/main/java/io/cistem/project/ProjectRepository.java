package io.cistem.project;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** The {@code projects} table. Rows come back with no diagrams; {@link ProjectService} adds them. */
@Repository
public class ProjectRepository {

    private static final String COLUMNS = "id, title, share_token, created_at, updated_at";

    private final JdbcClient jdbc;

    public ProjectRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /** The owner's projects, newest-updated first. */
    public List<Project> list(UUID owner) {
        return jdbc.sql("select " + COLUMNS + " from projects where owner_id = :o order by updated_at desc").param("o", owner).query(ProjectRepository::map).list();
    }

    public Optional<Project> find(UUID owner, UUID id) {
        return jdbc.sql("select " + COLUMNS + " from projects where id = :id and owner_id = :o").param("id", id).param("o", owner).query(ProjectRepository::map).optional();
    }

    public Optional<Project> findByShareToken(String token) {
        return jdbc.sql("select " + COLUMNS + " from projects where share_token = :t").param("t", token).query(ProjectRepository::map).optional();
    }

    public Project insert(UUID owner, String title) {
        UUID id = UUID.randomUUID();
        jdbc.sql("insert into projects (id, owner_id, title) values (:id, :o, :title)").param("id", id).param("o", owner).param("title", title).update();
        return find(owner, id).orElseThrow();
    }

    /**
     * The owner's oldest project, creating one called {@code title} if they have none. Serialised per owner (an
     * advisory lock for the transaction), so two first requests racing each other can't create two.
     */
    @Transactional
    public Project oldestOrCreate(UUID owner, String title) {
        jdbc.sql("select pg_advisory_xact_lock(hashtextextended(:o, 0))").param("o", owner.toString()).query().listOfRows();
        return jdbc.sql("select " + COLUMNS + " from projects where owner_id = :o order by created_at, id limit 1").param("o", owner)
                .query(ProjectRepository::map).optional()
                .orElseGet(() -> insert(owner, title));
    }

    public Optional<Project> rename(UUID owner, UUID id, String title) {
        jdbc.sql("update projects set title = :title, updated_at = now() where id = :id and owner_id = :o").param("title", title).param("id", id).param("o", owner).update();
        return find(owner, id);
    }

    /** Deletes the project; the database deletes its diagrams with it (on delete cascade). */
    public boolean delete(UUID owner, UUID id) {
        return jdbc.sql("delete from projects where id = :id and owner_id = :o").param("id", id).param("o", owner).update() == 1;
    }

    public Optional<Project> setShareToken(UUID owner, UUID id, String token) {
        jdbc.sql("update projects set share_token = :t where id = :id and owner_id = :o").param("t", token).param("id", id).param("o", owner).update();
        return find(owner, id);
    }

    /** Mark the project as just changed (a diagram in it was created, saved or moved in). */
    public void touch(UUID id) {
        jdbc.sql("update projects set updated_at = now() where id = :id").param("id", id).update();
    }

    private static Project map(ResultSet rs, int i) throws SQLException {
        String token = rs.getString("share_token");
        return new Project(rs.getObject("id", UUID.class), rs.getString("title"), token != null, token,
                rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getObject("updated_at", OffsetDateTime.class).toInstant(), List.of());
    }
}
