package com.ftpanimeplayer.sync.ftp;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.sftp.FileAttributes;
import net.schmizz.sshj.sftp.FileMode;
import net.schmizz.sshj.sftp.RemoteFile;
import net.schmizz.sshj.sftp.RemoteResourceInfo;
import net.schmizz.sshj.sftp.SFTPClient;
import net.schmizz.sshj.transport.verification.PromiscuousVerifier;

import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.RemoteEntry;

/**
 * SFTP implementation backed by sshj. Mirrors {@code src/main/ftp/sftp.ts}.
 */
class SftpClient implements FtpClient {

    private final FtpServerConfig cfg;
    private SSHClient ssh;
    private SFTPClient sftp;

    SftpClient(FtpServerConfig cfg) {
        this.cfg = cfg;
    }

    @Override
    public void connect() throws IOException {
        SSHClient c = new SSHClient();
        if (Boolean.TRUE.equals(cfg.getAllowSelfSigned())) {
            c.addHostKeyVerifier(new PromiscuousVerifier());
        } else {
            c.loadKnownHosts();
        }
        c.setConnectTimeout(20_000);
        c.setTimeout(30_000);
        c.connect(cfg.getHost(), cfg.getPort() > 0 ? cfg.getPort() : 22);
        c.authPassword(nullToEmpty(cfg.getUsername()), nullToEmpty(cfg.getPassword()));
        this.ssh = c;
        this.sftp = c.newSFTPClient();
    }

    @Override
    public List<RemoteEntry> list(String path) throws IOException {
        requireConnected();
        List<RemoteResourceInfo> entries = sftp.ls(path);
        List<RemoteEntry> out = new ArrayList<>(entries.size());
        for (RemoteResourceInfo info : entries) {
            String name = info.getName();
            if (".".equals(name) || "..".equals(name)) continue;
            RemoteEntry.Type type = info.getAttributes().getType() == FileMode.Type.DIRECTORY
                    ? RemoteEntry.Type.directory
                    : RemoteEntry.Type.file;
            long modSeconds = info.getAttributes().getMtime();
            String child = path.endsWith("/") ? path + name : path + "/" + name;
            out.add(new RemoteEntry(
                    name,
                    child,
                    type,
                    info.getAttributes().getSize(),
                    modSeconds > 0 ? modSeconds * 1000L : null));
        }
        return out;
    }

    @Override
    public long size(String path) throws IOException {
        requireConnected();
        FileAttributes attrs = sftp.stat(path);
        return attrs.getSize();
    }

    @Override
    public InputStream openReadStream(String path, long start, long end) throws IOException {
        requireConnected();
        RemoteFile file = sftp.open(path);
        long length = (end >= start && end > 0) ? end - Math.max(start, 0) + 1 : Long.MAX_VALUE;
        long offset = Math.max(start, 0);
        InputStream stream = file.new RemoteFileInputStream(offset);
        if (length != Long.MAX_VALUE) {
            stream = new BoundedInputStream(stream, length);
        }
        return new OwnedRemoteFileStream(stream, file);
    }

    @Override
    public void disconnect() {
        if (sftp != null) {
            try { sftp.close(); } catch (IOException ignored) { }
            sftp = null;
        }
        if (ssh != null) {
            try { ssh.disconnect(); } catch (IOException ignored) { }
            ssh = null;
        }
    }

    private void requireConnected() throws IOException {
        if (sftp == null) throw new IOException("sftp client is not connected");
    }

    private static String nullToEmpty(String s) { return s == null ? "" : s; }

    private static final class BoundedInputStream extends FilterInputStream {
        private long remaining;

        BoundedInputStream(InputStream in, long max) {
            super(in);
            this.remaining = max;
        }

        @Override
        public int read() throws IOException {
            if (remaining <= 0) return -1;
            int b = super.read();
            if (b >= 0) remaining--;
            return b;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (remaining <= 0) return -1;
            int read = super.read(b, off, (int) Math.min(len, remaining));
            if (read > 0) remaining -= read;
            return read;
        }
    }

    /** Closes the upstream {@link RemoteFile} when the stream is closed. */
    private static final class OwnedRemoteFileStream extends FilterInputStream {
        private final RemoteFile file;

        OwnedRemoteFileStream(InputStream in, RemoteFile file) {
            super(in);
            this.file = file;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                try { file.close(); } catch (IOException ignored) { }
            }
        }
    }
}
