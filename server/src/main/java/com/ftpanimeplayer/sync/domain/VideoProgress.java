package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code VideoProgress} in {@code src/shared/types.ts}. */
public class VideoProgress {
    private String serverId;
    private String path;
    private long size;
    private double positionSeconds;
    private double durationSeconds;
    private long updatedAt;
    private String videoName;
    private String animeTitle;
    private String posterPath;

    public String getServerId() { return serverId; }
    public void setServerId(String v) { this.serverId = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public long getSize() { return size; }
    public void setSize(long v) { this.size = v; }
    public double getPositionSeconds() { return positionSeconds; }
    public void setPositionSeconds(double v) { this.positionSeconds = v; }
    public double getDurationSeconds() { return durationSeconds; }
    public void setDurationSeconds(double v) { this.durationSeconds = v; }
    public long getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(long v) { this.updatedAt = v; }
    public String getVideoName() { return videoName; }
    public void setVideoName(String v) { this.videoName = v; }
    public String getAnimeTitle() { return animeTitle; }
    public void setAnimeTitle(String v) { this.animeTitle = v; }
    public String getPosterPath() { return posterPath; }
    public void setPosterPath(String v) { this.posterPath = v; }
}
