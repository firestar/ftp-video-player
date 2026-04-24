package com.ftpanimeplayer.sync.domain;

import java.util.List;

/** Mirrors {@code AnimeMetadata} in {@code src/shared/types.ts}. */
public class AnimeMetadata {
    private Integer malId;
    private String title;
    private String englishTitle;
    private String japaneseTitle;
    private String synopsis;
    private Double score;
    private Integer year;
    private Integer episodes;
    private String type;
    private List<String> genres;
    private List<String> tags;
    private String imageUrl;
    private String posterPath;

    public Integer getMalId() { return malId; }
    public void setMalId(Integer v) { this.malId = v; }
    public String getTitle() { return title; }
    public void setTitle(String v) { this.title = v; }
    public String getEnglishTitle() { return englishTitle; }
    public void setEnglishTitle(String v) { this.englishTitle = v; }
    public String getJapaneseTitle() { return japaneseTitle; }
    public void setJapaneseTitle(String v) { this.japaneseTitle = v; }
    public String getSynopsis() { return synopsis; }
    public void setSynopsis(String v) { this.synopsis = v; }
    public Double getScore() { return score; }
    public void setScore(Double v) { this.score = v; }
    public Integer getYear() { return year; }
    public void setYear(Integer v) { this.year = v; }
    public Integer getEpisodes() { return episodes; }
    public void setEpisodes(Integer v) { this.episodes = v; }
    public String getType() { return type; }
    public void setType(String v) { this.type = v; }
    public List<String> getGenres() { return genres; }
    public void setGenres(List<String> v) { this.genres = v; }
    public List<String> getTags() { return tags; }
    public void setTags(List<String> v) { this.tags = v; }
    public String getImageUrl() { return imageUrl; }
    public void setImageUrl(String v) { this.imageUrl = v; }
    public String getPosterPath() { return posterPath; }
    public void setPosterPath(String v) { this.posterPath = v; }
}
