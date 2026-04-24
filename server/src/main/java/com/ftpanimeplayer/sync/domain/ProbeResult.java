package com.ftpanimeplayer.sync.domain;

import java.util.ArrayList;
import java.util.List;

/** Mirrors {@code ProbeResult} in {@code src/shared/types.ts}. */
public class ProbeResult {
    private String container;
    private Double duration;
    private String videoCodec;
    private String audioCodec;
    private List<SubtitleTrackInfo> subtitles = new ArrayList<>();
    private boolean directPlayable;

    public String getContainer() { return container; }
    public void setContainer(String v) { this.container = v; }
    public Double getDuration() { return duration; }
    public void setDuration(Double v) { this.duration = v; }
    public String getVideoCodec() { return videoCodec; }
    public void setVideoCodec(String v) { this.videoCodec = v; }
    public String getAudioCodec() { return audioCodec; }
    public void setAudioCodec(String v) { this.audioCodec = v; }
    public List<SubtitleTrackInfo> getSubtitles() { return subtitles; }
    public void setSubtitles(List<SubtitleTrackInfo> v) { this.subtitles = v; }
    public boolean isDirectPlayable() { return directPlayable; }
    public void setDirectPlayable(boolean v) { this.directPlayable = v; }
}
