package com.ftpanimeplayer.sync.ftp;

import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import com.ftpanimeplayer.sync.domain.RemoteEntry;

/**
 * Platform-agnostic FTP/FTPS/SFTP client. Mirrors the {@code IFtpClient}
 * interface in {@code src/main/ftp/client.ts}.
 *
 * <p>Implementations are not required to be thread-safe — the server layer
 * allocates one client per request and gates total concurrency via
 * {@link FtpPool}.
 */
public interface FtpClient extends Closeable {

    /** Open the underlying connection / session. */
    void connect() throws IOException;

    /** Close the underlying connection. Safe to call multiple times. */
    void disconnect();

    List<RemoteEntry> list(String path) throws IOException;

    long size(String path) throws IOException;

    /**
     * Open a read stream at an optional byte offset range. {@code end} is
     * inclusive. If {@code start < 0} the stream is served from zero;
     * implementations may ignore {@code end} if the protocol does not
     * support it.
     */
    InputStream openReadStream(String path, long start, long end) throws IOException;

    @Override
    default void close() {
        disconnect();
    }
}
