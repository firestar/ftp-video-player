package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code VideoFile} in {@code src/shared/types.ts}. */
public class VideoFile {
    private String name;
    private String path;
    private long size;
    private Long modifiedAt;
    private String thumbnailPath;
    private Double durationSeconds;

    public String getName() { return name; }
    public void setName(String v) { this.name = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public long getSize() { return size; }
    public void setSize(long v) { this.size = v; }
    public Long getModifiedAt() { return modifiedAt; }
    public void setModifiedAt(Long v) { this.modifiedAt = v; }
    public String getThumbnailPath() { return thumbnailPath; }
    public void setThumbnailPath(String v) { this.thumbnailPath = v; }
    public Double getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(Double v) { this.durationSeconds = v; }
}
