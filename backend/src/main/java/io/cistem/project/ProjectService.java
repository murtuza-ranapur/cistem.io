package io.cistem.project;

import io.cistem.diagram.Diagram;
import io.cistem.diagram.DiagramRepository;
import io.cistem.diagram.NotFound;
import io.cistem.diagram.ShareTokens;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A user's projects: the rules shared by the HTTP API, the MCP tools and {@link io.cistem.diagram.DiagramService}.
 * Every operation is scoped to the owner. An account always has a project to put diagrams in: when it has none,
 * listing projects or creating a diagram first creates {@value #DEFAULT_TITLE}.
 */
@Service
public class ProjectService {

    public static final String DEFAULT_TITLE = "My diagrams";
    static final int MAX_TITLE = 200;

    private final ProjectRepository repo;
    private final DiagramRepository diagrams;

    public ProjectService(ProjectRepository repo, DiagramRepository diagrams) {
        this.repo = repo;
        this.diagrams = diagrams;
    }

    /** Every project with its diagrams; never empty. */
    public List<Project> list(UUID owner) {
        List<Project> projects = repo.list(owner);
        if (projects.isEmpty()) {
            defaultProject(owner);
            projects = repo.list(owner);
        }
        Map<UUID, List<Diagram.Summary>> byProject = diagrams.list(owner, null).stream()
                .filter(d -> d.projectId() != null)
                .collect(Collectors.groupingBy(Diagram.Summary::projectId));   // keeps each list's newest-first order
        return projects.stream().map(p -> p.withDiagrams(byProject.getOrDefault(p.id(), List.of()))).toList();
    }

    /** The project with its diagrams. */
    public Project get(UUID owner, UUID id) {
        return withDiagrams(owner, require(owner, id));
    }

    /** The project (without its diagrams), if it's the owner's; else {@link NotFound}. */
    public Project require(UUID owner, UUID id) {
        return repo.find(owner, id).orElseThrow(() -> new NotFound("project", id));
    }

    /** Where a diagram goes when no project is named: the oldest project, created if there is none. */
    public UUID defaultProject(UUID owner) {
        return repo.oldestOrCreate(owner, DEFAULT_TITLE).id();
    }

    public Project create(UUID owner, String title) {
        return repo.insert(owner, title(title));
    }

    public Project rename(UUID owner, UUID id, String title) {
        return withDiagrams(owner, repo.rename(owner, id, title(title)).orElseThrow(() -> new NotFound("project", id)));
    }

    /** Deletes the project and every diagram in it. Deleting the last one is allowed; a new default appears when needed. */
    public void delete(UUID owner, UUID id) {
        if (!repo.delete(owner, id)) throw new NotFound("project", id);
    }

    /** Create (or rotate) a read-only share link to the whole project. */
    public Project share(UUID owner, UUID id) {
        return withDiagrams(owner, repo.setShareToken(owner, id, ShareTokens.next()).orElseThrow(() -> new NotFound("project", id)));
    }

    public void unshare(UUID owner, UUID id) {
        require(owner, id);
        repo.setShareToken(owner, id, null);
    }

    /** A shared project, for anyone with the link: its title and full diagrams, without any share tokens. */
    public Optional<Project.Shared> shared(String token) {
        return repo.findByShareToken(token).map(p ->
                new Project.Shared(p.title(), diagrams.listInProject(p.id()).stream().map(Diagram::withoutShareToken).toList()));
    }

    /** Record that a diagram in the project was created, saved or moved in. */
    public void touch(UUID id) {
        if (id != null) repo.touch(id);
    }

    private Project withDiagrams(UUID owner, Project p) {
        return p.withDiagrams(diagrams.list(owner, p.id()));
    }

    /** Trimmed, required, at most {@value #MAX_TITLE} characters. */
    static String title(String raw) {
        String t = raw == null ? "" : raw.trim();
        if (t.isEmpty()) throw new IllegalArgumentException("A project needs a title");
        if (t.length() > MAX_TITLE) throw new IllegalArgumentException("A project title can be at most " + MAX_TITLE + " characters");
        return t;
    }
}
