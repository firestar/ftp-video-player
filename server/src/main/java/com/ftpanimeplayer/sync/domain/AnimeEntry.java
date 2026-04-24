package com.ftpanimeplayer.sync.domain;

import java.util.ArrayList;
import java.util.List;

/** Mirrors {@code AnimeEntry} in {@code src/shared/types.ts}. */
public class AnimeEntry {
    private String id;
    private String serverId;
    private String libraryRootId;
    private String folderName;
    private String path;
    private AnimeMetadata metadata;
    private List<VideoFile> videos = new ArrayList<>();
    private Long lastScannedAt;

    public String getId() { return id; }
    public void setId(String v) { this.id = v; }
    public String getServerId() { return serverId; }
    public void setServerId(String v) { this.serverId = v; }
    public String getLibraryRootId() { return libraryRootId; }
    public void setLibraryRootId(String v) { this.libraryRootId = v; }
    public String getFolderName() { return folderName; }
    public void setFolderName(String v) { this.folderName = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public AnimeMetadata getMetadata() { return metadata; }
    public void setMetadata(AnimeMetadata v) { this.metadata = v; }
    public List<VideoFile> getVideos() { return videos; }
    public void setVideos(List<VideoFile> v) { this.videos = v; }
    public Long getLastScannedAt() { return lastScannedAt; }
    public void setLastScannedAt(Long v) { this.lastScannedAt = v; }
}
