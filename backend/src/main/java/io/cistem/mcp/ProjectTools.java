package io.cistem.mcp;

import io.cistem.diagram.Diagram;
import io.cistem.project.Project;
import io.cistem.project.ProjectService;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;

import java.util.List;

/** Projects: named groups of diagrams. Every diagram is in exactly one project. */
@Component
public class ProjectTools {

    private final ProjectService projects;
    private final Diagrams diagrams;

    public ProjectTools(ProjectService projects, Diagrams diagrams) {
        this.projects = projects;
        this.diagrams = diagrams;
    }

    @McpTool(name = "list_projects", description = """
            List the user's projects (named groups of diagrams), newest-updated first: id, title, whether it's shared, and
            its diagrams (id, title, kind, version, last updated). Every diagram is in exactly one project.""")
    public List<Project> listProjects() {
        return projects.list(diagrams.owner());
    }

    @McpTool(name = "create_project", description = "Create an empty project. Returns it with its id; pass that id as projectId to the create tools or move_to_project.")
    public Project createProject(@McpToolParam(description = "Title (at most 200 characters)") String title) {
        return projects.create(diagrams.owner(), title);
    }

    @McpTool(name = "rename_project", description = "Change a project's title.")
    public Project renameProject(@McpToolParam(description = "Project id") String projectId,
                                 @McpToolParam(description = "New title (at most 200 characters)") String title) {
        return projects.rename(diagrams.owner(), projectId(projectId), title);
    }

    @McpTool(name = "delete_project", description = """
            Permanently delete a project AND every diagram in it; this can't be undone. Before calling this, tell the user
            which project and how many diagrams will be deleted, and get their explicit confirmation. To keep some diagrams,
            move them to another project first (move_to_project).""")
    public String deleteProject(@McpToolParam(description = "Project id") String projectId) {
        projects.delete(diagrams.owner(), projectId(projectId));
        return "deleted";
    }

    @McpTool(name = "move_to_project", description = "Move a diagram to another project. Its id, version and content stay the same.")
    public Diagram.Summary moveToProject(@McpToolParam(description = "Diagram id") String diagramId,
                                         @McpToolParam(description = "Id of the project to move it to") String projectId) {
        return diagrams.service().move(diagrams.owner(), Diagrams.uuid(diagramId), projectId(projectId));
    }

    private static java.util.UUID projectId(String id) {
        return Diagrams.uuid(id, "project");
    }
}
