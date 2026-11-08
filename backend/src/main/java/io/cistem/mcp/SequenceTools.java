package io.cistem.mcp;

import io.cistem.diagram.Diagram;
import io.cistem.diagram.DiagramFiles;
import io.cistem.engine.Seq;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.util.*;

import static io.cistem.mcp.Json.*;

/** Sequence diagrams, read and written in their text format. */
@Component
public class SequenceTools {

    private final Diagrams diagrams;
    private final ObjectMapper om;

    public SequenceTools(Diagrams diagrams, ObjectMapper om) {
        this.diagrams = diagrams;
        this.om = om;
    }

    // ---------- sequence diagrams ----------

    private static final String SEQ_FORMAT = """
            Text format, one statement per line:
              participant web, api                         lifelines in order (declared ones first; others appear as used)
              participant pay "payment-service" service @n3   id, display name, component type, linked component id
              web -> api: POST /orders                     call
              api --> web: 201 Created                     reply
              api ->> events: order.created                async message
              note over api, db: text
              alt condition / else other / end            also opt, loop, par (par branches use `and`)
            Ids are letters, digits, - _ . with no spaces. Link a lifeline to a component (@id) of the system diagram
            the sequence uses to get end-to-end timings in the editor.""";

    @McpTool(name = "create_sequence", description = """
            Create a sequence diagram from text. Optionally name the system diagram it draws on (its id), so lifelines
            can link to that diagram's components (@componentId) and the editor shows timings from its capacity model.
            Returns the new diagram's id.
            """ + SEQ_FORMAT)
    public ObjectNode createSequence(@McpToolParam(description = "Title") String title,
                                     @McpToolParam(description = "The sequence, in the text format") String text,
                                     @McpToolParam(description = "Id of the system diagram it uses (optional)", required = false) String systemDiagramId) {
        Seq.Parsed p = parseOrThrow(text);
        if (!blank(systemDiagramId)) {
            Diagram sys = diagrams.load(systemDiagramId);
            if (!"system".equals(sys.kind())) throw new IllegalArgumentException("systemDiagramId must be a system diagram");
            p.model().putObject("uses").put("id", sys.id().toString()).put("title", sys.title());
        }
        ObjectNode file = DiagramFiles.create(om, "sequence", title);
        file.set("model", p.model());
        return diagrams.savedResult(diagrams.insert(file)).put("text", Seq.print(p.model()));
    }

    @McpTool(name = "get_sequence", description = "Read a sequence diagram as text (the format create_sequence takes), with its lifelines and the system diagram it uses.")
    public ObjectNode getSequence(@McpToolParam(description = "Diagram id") String diagramId) {
        Diagram d = diagrams.load(diagramId);
        ObjectNode file = diagrams.read(diagramId, "sequence");
        ObjectNode out = diagrams.savedResult(d).put("title", d.title());
        out.put("text", Seq.print(file.path("model")));
        out.set("participants", file.path("model").path("participants").deepCopy());
        if (file.path("model").has("uses")) out.set("uses", file.path("model").get("uses").deepCopy());
        return out;
    }

    @McpTool(name = "set_sequence", description = "Replace a sequence diagram's content with new text (same format as create_sequence). The system diagram it uses is kept.\n" + SEQ_FORMAT)
    public ObjectNode setSequence(@McpToolParam(description = "Diagram id") String diagramId,
                                  @McpToolParam(description = "The whole sequence, in the text format") String text) {
        Seq.Parsed p = parseOrThrow(text);
        var saved = diagrams.edit(diagramId, "sequence", file -> {
            Seq.keepIds(file.path("model"), p.model());
            JsonNode uses = file.path("model").path("uses");
            if (uses.isObject() && !p.model().has("uses")) p.model().set("uses", uses);
            file.set("model", p.model());
        });
        return diagrams.savedResult(saved.diagram()).put("text", Seq.print(p.model()));
    }

    private Seq.Parsed parseOrThrow(String text) {
        Seq.Parsed p = Seq.parse(text == null ? "" : text, om);
        if (!p.errors().isEmpty()) {
            StringBuilder b = new StringBuilder("The sequence text has problems:");
            for (Seq.Error e : p.errors()) b.append("\n  line ").append(e.line() + 1).append(": ").append(e.message());
            throw new IllegalArgumentException(b.toString());
        }
        return p;
    }
}
