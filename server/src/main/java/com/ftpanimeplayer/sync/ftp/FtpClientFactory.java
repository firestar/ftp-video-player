package com.ftpanimeplayer.sync.ftp;

import java.io.IOException;

import org.springframework.stereotype.Component;

import com.ftpanimeplayer.sync.domain.FtpProtocol;
import com.ftpanimeplayer.sync.domain.FtpServerConfig;

/**
 * Hands out protocol-appropriate {@link FtpClient} instances and wraps them
 * in an {@link FtpPool} permit so upstream code doesn't have to remember to
 * gate concurrency.
 */
@Component
public class FtpClientFactory {

    private final FtpPool pool;

    public FtpClientFactory(FtpPool pool) {
        this.pool = pool;
    }

    /**
     * Returns a client that has already been connected and holds a pool
     * permit. Closing the client releases the permit.
     */
    public FtpClient open(FtpServerConfig cfg) throws IOException {
        FtpPool.Permit permit;
        try {
            permit = pool.acquire(cfg);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted while acquiring FTP permit", e);
        }
        FtpClient inner;
        try {
            inner = switch (cfg.getProtocol()) {
                case ftp, ftps -> new BasicFtpClient(cfg);
                case sftp -> new SftpClient(cfg);
            };
            inner.connect();
        } catch (RuntimeException | IOException e) {
            permit.close();
            throw e;
        }
        return new PooledFtpClient(inner, permit);
    }

    /**
     * Helper used by {@code /servers/{id}/test}: open and disconnect the
     * client, converting any exception to a string message.
     */
    public String testConnection(FtpServerConfig cfg) {
        try (FtpClient ignored = open(cfg)) {
            return null;
        } catch (Exception e) {
            return e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        }
    }

    /** Protocol null-check guard; pair with FtpProtocol for static dispatch. */
    private static void rejectUnknown(FtpProtocol protocol) {
        if (protocol == null) {
            throw new IllegalArgumentException("ftp protocol is required");
        }
    }
}
