package com.ftpanimeplayer.sync.ftp;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.ftpanimeplayer.sync.domain.FtpServerConfig;

/**
 * Per-server connection-concurrency gate. Mirrors
 * {@code src/main/ftp/pool.ts}: many FTP servers (especially those hosting
 * anime libraries) cap concurrent sessions at 1-2 per user. Trying to exceed
 * that cap results in refused connections that look like random network
 * failures, so we serialize here before even attempting to connect.
 *
 * <p>{@code maxConcurrentConnections <= 0} means unlimited (we still wrap
 * with a permit-less gate to keep the API uniform).
 */
@Component
public class FtpPool {

    private static final int UNLIMITED = Integer.MAX_VALUE;

    private final Map<String, ServerGate> gates = new ConcurrentHashMap<>();

    public Permit acquire(FtpServerConfig cfg) throws InterruptedException {
        ServerGate gate = gates.compute(cfg.getId(), (id, existing) -> {
            int wanted = resolveLimit(cfg);
            if (existing == null || existing.limit != wanted) {
                return new ServerGate(wanted);
            }
            return existing;
        });
        gate.semaphore.acquire();
        return new Permit(gate);
    }

    private int resolveLimit(FtpServerConfig cfg) {
        Integer n = cfg.getMaxConcurrentConnections();
        if (n == null || n <= 0) return UNLIMITED;
        return n;
    }

    /** Released on {@link #close()} to free a permit back to the gate. */
    public static final class Permit implements AutoCloseable {
        private final ServerGate gate;
        private boolean released;

        private Permit(ServerGate gate) {
            this.gate = gate;
        }

        @Override
        public void close() {
            if (released) return;
            released = true;
            gate.semaphore.release();
        }
    }

    /** For tests: drain permits with a timeout to confirm the gate is closed. */
    boolean tryAcquireForTest(String serverId, long timeoutMs) throws InterruptedException {
        ServerGate gate = gates.get(serverId);
        if (gate == null) return true;
        return gate.semaphore.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS);
    }

    private static final class ServerGate {
        final int limit;
        final Semaphore semaphore;

        ServerGate(int limit) {
            this.limit = limit;
            this.semaphore = new Semaphore(limit, /* fair */ true);
        }
    }
}
