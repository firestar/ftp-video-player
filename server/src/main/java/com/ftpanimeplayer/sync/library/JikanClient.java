package com.ftpanimeplayer.sync.library;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;

import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import com.fasterxml.jackson.databind.JsonNode;
import com.ftpanimeplayer.sync.config.PlayerProperties;
import com.ftpanimeplayer.sync.config.SyncProperties;
import com.ftpanimeplayer.sync.domain.AnimeMetadata;

import jakarta.annotation.PostConstruct;

/**
 * Talks to the Jikan v4 public MyAnimeList mirror. Mirrors the behaviour of
 * {@code src/main/anime.ts} + {@code src/main/metadataWorker.ts}: rate-limit
 * to one request at a time, download the poster to a local cache, and store
 * the path so clients can fetch it through {@code /api/sync/cache/posters/…}.
 */
@Component
public class JikanClient {

    private final PlayerProperties playerProperties;
    private final SyncProperties syncProperties;
    private final Semaphore gate = new Semaphore(1, true);
    private WebClient client;
    private Path posterDir;

    public JikanClient(PlayerProperties playerProperties, SyncProperties syncProperties) {
        this.playerProperties = playerProperties;
        this.syncProperties = syncProperties;
    }

    @PostConstruct
    void init() {
        this.client = WebClient.builder()
                .baseUrl(playerProperties.getJikanBaseUrl())
                .build();
        String user = syncProperties.getUsers().isEmpty()
                ? "admin"
                : syncProperties.getUsers().get(0).getUsername();
        this.posterDir = Paths.get(syncProperties.getDataDir(), "users", user, "cache", "posters");
        try {
            Files.createDirectories(posterDir);
        } catch (Exception e) {
            throw new RuntimeException("cannot create poster dir " + posterDir, e);
        }
    }

    /** Normalize a folder name so it searches cleanly on MAL. */
    public static String normalizeFolderName(String name) {
        if (name == null) return "";
        String s = name.replaceAll("\\[[^\\]]*\\]", " ")
                .replaceAll("\\([^)]*\\)", " ")
                .replaceAll("(?i)\\b(1080p|720p|480p|2160p|4k|bluray|bdrip|web-?dl|hevc|x264|x265|dual audio|multi audio)\\b", " ")
                .replaceAll("[._]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return s;
    }

    public List<AnimeMetadata> search(String query) {
        if (query == null || query.isBlank()) return List.of();
        gate.acquireUninterruptibly();
        try {
            JsonNode response = client.get()
                    .uri(u -> u.path("/anime").queryParam("q", query).queryParam("limit", 10).build())
                    .retrieve()
                    .bodyToMono(JsonNode.class)
                    .timeout(Duration.ofSeconds(15))
                    .block();
            if (response == null) return List.of();
            JsonNode data = response.get("data");
            if (data == null || !data.isArray()) return List.of();
            List<AnimeMetadata> out = new ArrayList<>();
            for (JsonNode node : data) {
                out.add(parse(node));
            }
            return out;
        } catch (Exception e) {
            return List.of();
        } finally {
            gate.release();
        }
    }

    /** First hit of a search + poster download, all rolled up. */
    public AnimeMetadata resolveBest(String query) {
        List<AnimeMetadata> hits = search(query);
        if (hits.isEmpty()) return null;
        AnimeMetadata best = hits.get(0);
        if (best.getImageUrl() != null && best.getPosterPath() == null) {
            String local = downloadPoster(best.getImageUrl(), query);
            if (local != null) best.setPosterPath(local);
        }
        return best;
    }

    public String downloadPoster(String imageUrl, String cacheKey) {
        if (imageUrl == null) return null;
        try {
            String hash = sha1(cacheKey + "|" + imageUrl);
            Path target = posterDir.resolve(hash + ".jpg");
            if (Files.exists(target)) return target.toAbsolutePath().toString();
            byte[] body = WebClient.create().get().uri(imageUrl).retrieve()
                    .bodyToMono(byte[].class)
                    .timeout(Duration.ofSeconds(30))
                    .block();
            if (body == null || body.length == 0) return null;
            Files.write(target, body);
            return target.toAbsolutePath().toString();
        } catch (Exception e) {
            return null;
        }
    }

    private static AnimeMetadata parse(JsonNode node) {
        AnimeMetadata m = new AnimeMetadata();
        if (node.hasNonNull("mal_id")) m.setMalId(node.get("mal_id").asInt());
        if (node.hasNonNull("title")) m.setTitle(node.get("title").asText());
        if (node.hasNonNull("title_english")) m.setEnglishTitle(node.get("title_english").asText());
        if (node.hasNonNull("title_japanese")) m.setJapaneseTitle(node.get("title_japanese").asText());
        if (node.hasNonNull("synopsis")) m.setSynopsis(node.get("synopsis").asText());
        if (node.hasNonNull("score")) m.setScore(node.get("score").asDouble());
        if (node.hasNonNull("year")) m.setYear(node.get("year").asInt());
        if (node.hasNonNull("episodes")) m.setEpisodes(node.get("episodes").asInt());
        if (node.hasNonNull("type")) m.setType(node.get("type").asText());
        JsonNode genres = node.get("genres");
        if (genres != null && genres.isArray()) {
            List<String> list = new ArrayList<>();
            for (JsonNode g : genres) list.add(g.path("name").asText());
            m.setGenres(list);
        }
        JsonNode themes = node.get("themes");
        JsonNode demos = node.get("demographics");
        List<String> tags = new ArrayList<>();
        for (JsonNode src : List.of(themes == null ? emptyNode() : themes, demos == null ? emptyNode() : demos)) {
            if (src.isArray()) {
                for (JsonNode t : src) tags.add(t.path("name").asText());
            }
        }
        if (!tags.isEmpty()) m.setTags(tags);
        JsonNode images = node.get("images");
        if (images != null) {
            JsonNode jpg = images.get("jpg");
            if (jpg != null && jpg.hasNonNull("large_image_url")) m.setImageUrl(jpg.get("large_image_url").asText());
            else if (jpg != null && jpg.hasNonNull("image_url")) m.setImageUrl(jpg.get("image_url").asText());
        }
        return m;
    }

    private static JsonNode emptyNode() {
        // Constant-free placeholder so callers can treat missing arrays like empty arrays.
        return com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.arrayNode();
    }

    private static String sha1(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            byte[] digest = md.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    /** Exposed for tests that want to inject known poster contents. */
    public Path posterDir() { return posterDir; }

    @SuppressWarnings("unused")
    private static final Class<?> _keepMap = Map.class;
}
