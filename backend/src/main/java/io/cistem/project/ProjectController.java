package io.cistem.project;

import io.cistem.auth.CurrentUser;
import io.cistem.diagram.NotFound;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * The browser's API over the signed-in user's projects. Errors are answered by {@code ApiErrors}, as for diagrams:
 * 404 for a project that is missing or someone else's, 400 for a bad title.
 */
@RestController
@RequestMapping("/api")
public class ProjectController {

    private final ProjectService projects;
    private final CurrentUser user;

    public ProjectController(ProjectService projects, CurrentUser user) {
        this.projects = projects;
        this.user = user;
    }

    public record ProjectBody(String title) {}

    @GetMapping("/projects")
    public List<Project> list() {
        return projects.list(user.id());
    }

    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    public Project create(@RequestBody ProjectBody body) {
        return projects.create(user.id(), body.title());
    }

    @PatchMapping("/projects/{id}")
    public Project rename(@PathVariable UUID id, @RequestBody ProjectBody body) {
        return projects.rename(user.id(), id, body.title());
    }

    /** Deletes the project and every diagram in it. */
    @DeleteMapping("/projects/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id) {
        projects.delete(user.id(), id);
    }

    @PostMapping("/projects/{id}/share")
    public Project share(@PathVariable UUID id) {
        return projects.share(user.id(), id);
    }

    @DeleteMapping("/projects/{id}/share")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unshare(@PathVariable UUID id) {
        projects.unshare(user.id(), id);
    }

    /** Public and read-only (GET /api/share/** is permitted in SecurityConfig). */
    @GetMapping("/share/project/{token}")
    public Project.Shared shared(@PathVariable String token) {
        return projects.shared(token).orElseThrow(() -> new NotFound("project", null));
    }
}
