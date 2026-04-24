package com.ftpanimeplayer.sync.domain;

/**
 * Mirrors {@code StreamHandle} in {@code src/shared/types.ts} — plus an
 * {@code hlsUrl} addition for mobile/TV clients.
 */
public class StreamHandle {
    private String token;
    private String directUrl;
    private String transcodeUrl;
    private String probeUrl;
    private String subtitleUrl;
    private String subtitlesUrl;
    private String hlsUrl;
    /** @deprecated Backwards-compat alias of {@link #directUrl}. */
    @Deprecated
    private String url;

    public String getToken() { return token; }
    public void setToken(String v) { this.token = v; }
    public String getDirectUrl() { return directUrl; }
    public void setDirectUrl(String v) { this.directUrl = v; }
    public String getTranscodeUrl() { return transcodeUrl; }
    public void setTranscodeUrl(String v) { this.transcodeUrl = v; }
    public String getProbeUrl() { return probeUrl; }
    public void setProbeUrl(String v) { this.probeUrl = v; }
    public String getSubtitleUrl() { return subtitleUrl; }
    public void setSubtitleUrl(String v) { this.subtitleUrl = v; }
    public String getSubtitlesUrl() { return subtitlesUrl; }
    public void setSubtitlesUrl(String v) { this.subtitlesUrl = v; }
    public String getHlsUrl() { return hlsUrl; }
    public void setHlsUrl(String v) { this.hlsUrl = v; }
    public String getUrl() { return url; }
    public void setUrl(String v) { this.url = v; }
}
