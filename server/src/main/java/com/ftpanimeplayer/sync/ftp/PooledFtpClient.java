package com.ftpanimeplayer.sync.ftp;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import com.ftpanimeplayer.sync.domain.RemoteEntry;

/**
 * Wraps a real {@link FtpClient} so that closing it both disconnects and
 * releases the {@link FtpPool} permit it was opened with.
 */
final class PooledFtpClient implements FtpClient {

    private final FtpClient delegate;
    private final FtpPool.Permit permit;
    private boolean closed;

    PooledFtpClient(FtpClient delegate, FtpPool.Permit permit) {
        this.delegate = delegate;
        this.permit = permit;
    }

    @Override
    public void connect() throws IOException {
        delegate.connect();
    }

    @Override
    public List<RemoteEntry> list(String path) throws IOException {
        return delegate.list(path);
    }

    @Override
    public long size(String path) throws IOException {
        return delegate.size(path);
    }

    @Override
    public InputStream openReadStream(String path, long start, long end) throws IOException {
        return delegate.openReadStream(path, start, end);
    }

    @Override
    public void disconnect() {
        if (closed) return;
        closed = true;
        try {
            delegate.disconnect();
        } finally {
            permit.close();
        }
    }
}
