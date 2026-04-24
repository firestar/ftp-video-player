package com.ftpanimeplayer.sync.domain;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Mirrors {@code SubtitleTrackInfo} in {@code src/shared/types.ts}. The
 * {@code isDefault} field is explicitly annotated so Jackson emits
 * {@code "isDefault"} (matching the TypeScript client) rather than its
 * default {@code "default"} derived from the {@code isDefault()} getter.
 */
public class SubtitleTrackInfo {
    private int index;
    private String codec;
    private String language;
    private String title;
    @JsonProperty("isDefault")
    private boolean isDefault;
    private boolean textBased;

    public int getIndex() { return index; }
    public void setIndex(int v) { this.index = v; }
    public String getCodec() { return codec; }
    public void setCodec(String v) { this.codec = v; }
    public String getLanguage() { return language; }
    public void setLanguage(String v) { this.language = v; }
    public String getTitle() { return title; }
    public void setTitle(String v) { this.title = v; }

    @JsonProperty("isDefault")
    public boolean getIsDefault() { return isDefault; }
    @JsonProperty("isDefault")
    public void setIsDefault(boolean v) { this.isDefault = v; }

    public boolean isTextBased() { return textBased; }
    public void setTextBased(boolean v) { this.textBased = v; }
}
