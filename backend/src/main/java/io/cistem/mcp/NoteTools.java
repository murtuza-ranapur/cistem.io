package io.cistem.mcp;

import io.cistem.diagram.Notes;
import org.springframework.ai.mcp.annotation.McpTool;
import org.springframework.ai.mcp.annotation.McpToolParam;
import org.springframework.stereotype.Component;
import tools.jackson.databind.node.ObjectNode;

/** Notes on any kind of diagram: sticky notes on the canvas, and notes on items. Text is markdown. */
@Component
public class NoteTools {

    static final String FORMAT = "Markdown: # headings, **bold**, *italic*, ++underline++, ~~strike~~, `code`, ==highlight==, "
            + "- bullets, 1. numbers, - [ ] / - [x] checklists, > quotes, > [!WARNING] / > [!TIP] / > [!INFO] callouts, ``` code blocks, tables, [links](https://…). "
            + "Link an item of the diagram with [@name](#cistem:node:<id>) (also container, class, part).";

    private final Diagrams diagrams;

    public NoteTools(Diagrams diagrams) {
        this.diagrams = diagrams;
    }

    @McpTool(name = "add_note", description = "Put a sticky note on a diagram's canvas (any kind). " + FORMAT)
    public ObjectNode addNote(@McpToolParam(description = "Diagram id") String diagramId,
                              @McpToolParam(description = "The note, in markdown") String text,
                              @McpToolParam(description = "Colour: yellow (default), blue, green, pink, grey or none", required = false) String color,
                              @McpToolParam(description = "Left edge in canvas units (default: under the diagram)", required = false) Double x,
                              @McpToolParam(description = "Top edge in canvas units", required = false) Double y) {
        String[] id = new String[1];
        var saved = diagrams.edit(diagramId, null, f -> id[0] = Notes.add(f, text, x, y, color));
        return diagrams.savedResult(saved.diagram()).put("noteId", id[0]);
    }

    @McpTool(name = "update_note", description = "Change a canvas note's text and/or colour. " + FORMAT)
    public ObjectNode updateNote(@McpToolParam(description = "Diagram id") String diagramId,
                                 @McpToolParam(description = "Note id (from get_diagram: model.notes)") String noteId,
                                 @McpToolParam(description = "New text in markdown (omit to keep)", required = false) String text,
                                 @McpToolParam(description = "New colour (omit to keep)", required = false) String color) {
        return diagrams.savedResult(diagrams.edit(diagramId, null, f -> Notes.update(f, noteId, text, color)).diagram());
    }

    @McpTool(name = "remove_note", description = "Remove a canvas note.")
    public ObjectNode removeNote(@McpToolParam(description = "Diagram id") String diagramId, @McpToolParam(description = "Note id") String noteId) {
        return diagrams.savedResult(diagrams.edit(diagramId, null, f -> Notes.remove(f, noteId)).diagram());
    }

    @McpTool(name = "set_item_notes", description = "Write the notes on one item: a component, connection or environment (by id), a lifeline (by id), "
            + "a class (by name) or a relation (by id). Empty text clears them. " + FORMAT)
    public ObjectNode setItemNotes(@McpToolParam(description = "Diagram id") String diagramId,
                                   @McpToolParam(description = "The item's id (a class's name)") String itemId,
                                   @McpToolParam(description = "The notes, in markdown") String text) {
        String[] what = new String[1];
        var saved = diagrams.edit(diagramId, null, f -> what[0] = Notes.setOnItem(f, itemId, text));
        return diagrams.savedResult(saved.diagram()).put("item", what[0]);
    }
}
