package io.cistem.diagram;

/** Thrown when no diagram or project with that id belongs to the user (or no share has that token). */
public class NotFound extends RuntimeException {

    private final String what;

    /** {@code what}: "diagram" or "project"; the id goes in the message (for agents) but not in the HTTP answer. */
    public NotFound(String what, Object id) {
        super(id == null ? "No such " + what : "No such " + what + ": " + id);
        this.what = what;
    }

    /** The message without the id, safe to show anyone. */
    public String publicMessage() {
        return "No such " + what;
    }
}
