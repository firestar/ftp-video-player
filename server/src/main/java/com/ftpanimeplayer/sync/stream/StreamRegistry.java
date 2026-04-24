package com.ftpanimeplayer.sync.stream;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Holds active stream tokens → {serverId, path, size} so the various
 * streaming endpoints only need a single opaque id. Mirrors
 * {@code registrations} in {@code src/main/stream-server.ts}.
 */
@Component
public class StreamRegistry {

    public static final class Registration {
        public final String token;
        public final String serverId;
        public final String path;
        public final long size;
        public volatile Map<Integer, String> subtitleCodecs;

        Registration(String token, String serverId, String path, long size) {
            this.token = token;
            this.serverId = serverId;
            this.path = path;
            this.size = size;
        }
    }

    private final Map<String, Registration> byToken = new ConcurrentHashMap<>();

    public Registration register(String serverId, String path, long size) {
        String token = UUID.randomUUID().toString();
        Registration reg = new Registration(token, serverId, path, size);
        byToken.put(token, reg);
        return reg;
    }

    public Optional<Registration> get(String token) {
        return Optional.ofNullable(byToken.get(token));
    }

    public void unregister(String token) {
        byToken.remove(token);
    }
}
