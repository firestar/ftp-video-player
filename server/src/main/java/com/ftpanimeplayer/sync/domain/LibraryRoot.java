package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code LibraryRoot} in {@code src/shared/types.ts}. */
public class LibraryRoot {
    private String id;
    private String serverId;
    private String path;
    private String label;

    public String getId() { return id; }
    public void setId(String v) { this.id = v; }
    public String getServerId() { return serverId; }
    public void setServerId(String v) { this.serverId = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public String getLabel() { return label; }
    public void setLabel(String v) { this.label = v; }
}
