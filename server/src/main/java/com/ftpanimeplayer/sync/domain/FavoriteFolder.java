package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code FavoriteFolder} in {@code src/shared/types.ts}. */
public class FavoriteFolder {
    private String serverId;
    private String libraryRootId;
    private String path;
    private long addedAt;

    public String getServerId() { return serverId; }
    public void setServerId(String v) { this.serverId = v; }
    public String getLibraryRootId() { return libraryRootId; }
    public void setLibraryRootId(String v) { this.libraryRootId = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public long getAddedAt() { return addedAt; }
    public void setAddedAt(long v) { this.addedAt = v; }
}
