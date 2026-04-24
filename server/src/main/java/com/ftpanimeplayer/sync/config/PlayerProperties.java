package com.ftpanimeplayer.sync.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Runtime knobs for the streaming/FTP layer. Values are sourced from
 * {@code application.yml} under the {@code player.*} prefix; every property
 * also has an environment variable override documented in the YAML.
 */
@ConfigurationProperties(prefix = "player")
public class PlayerProperties {
    private String ffmpegPath = "ffmpeg";
    private String ffprobePath = "ffprobe";
    private String transcodeDir = "./data/transcode";
    private String jikanBaseUrl = "https://api.jikan.moe/v4";
    private int maxConcurrentTranscodes = 2;

    public String getFfmpegPath() { return ffmpegPath; }
    public void setFfmpegPath(String v) { this.ffmpegPath = v; }
    public String getFfprobePath() { return ffprobePath; }
    public void setFfprobePath(String v) { this.ffprobePath = v; }
    public String getTranscodeDir() { return transcodeDir; }
    public void setTranscodeDir(String v) { this.transcodeDir = v; }
    public String getJikanBaseUrl() { return jikanBaseUrl; }
    public void setJikanBaseUrl(String v) { this.jikanBaseUrl = v; }
    public int getMaxConcurrentTranscodes() { return maxConcurrentTranscodes; }
    public void setMaxConcurrentTranscodes(int v) { this.maxConcurrentTranscodes = v; }
}
