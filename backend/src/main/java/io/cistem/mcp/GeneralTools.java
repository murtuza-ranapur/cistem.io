package io.cistem.mcp;

import io.cistem.diagram.Diagram;
import org.springframework.ai.mcp.annotation.McpResource;
import org.springframework.core.io.ClassPathResource;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.List;

import static io.cistem.mcp.Json.*;

/** Tools for any kind of diagram: list, read, rename, delete, and the file schema. */
@Component
public class GeneralTools {

    private final Diagrams diagrams;

    public GeneralTools(Diagrams diagrams) {
        this.diagrams = diagrams;
    }

    @McpTool(name = "list_diagrams", description = "List the user's diagrams, newest-updated first: id, projectId, title, kind, version, last updated. Pass projectId to list only the diagrams in that project (list_projects gives the projects).")
    public List<Diagram.Summary> listDiagrams(@McpToolParam(description = "Only diagrams in this project (id); omit for all", required = false) String projectId) {
        return diagrams.service().list(diagrams.owner(), Diagrams.optionalUuid(projectId, "project"));
    }

    @McpTool(name = "get_diagram", description = "Get a diagram's full document (cistem.dev file format: version, kind, meta, model, layout). For sequence diagrams get_sequence gives a readable text form.")
    public JsonNode getDiagram(@McpToolParam(description = "Diagram id (UUID)") String diagramId) {
        return diagrams.read(diagramId, null);
    }

    @McpTool(name = "delete_diagram", description = "Delete a diagram permanently.")
    public String deleteDiagram(@McpToolParam(description = "Diagram id") String diagramId) {
        diagrams.service().delete(diagrams.owner(), Diagrams.uuid(diagramId));
        return "deleted";
    }

    @McpTool(name = "rename_diagram", description = "Change the diagram title.")
    public ObjectNode rename(@McpToolParam(description = "Diagram id") String diagramId, @McpToolParam(description = "New title") String title) {
        if (blank(title)) throw new IllegalArgumentException("The title can't be empty");
        return diagrams.savedResult(diagrams.edit(diagramId, null, f -> object(f, "meta").put("title", title.trim())).diagram());
    }

    @McpResource(uri = "cistem://schema", name = "cistem.dev diagram schema", description = "JSON Schema (2020-12) for diagram files", mimeType = "application/schema+json")
    public String schema() throws IOException {
        return readSchema();
    }

    private static String readSchema() throws IOException {
        var cp = new ClassPathResource("static/schema/cistem.schema.json");   // bundled with the frontend build
        if (cp.exists()) return cp.getContentAsString(StandardCharsets.UTF_8);
        var local = java.nio.file.Path.of("..", "schema", "cistem.schema.json");   // running from backend/ in dev
        return java.nio.file.Files.readString(local);
    }
}
