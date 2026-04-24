package com.ftpanimeplayer.sync.ftp;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.List;

import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

import org.apache.commons.net.ftp.FTP;
import org.apache.commons.net.ftp.FTPClient;
import org.apache.commons.net.ftp.FTPFile;
import org.apache.commons.net.ftp.FTPReply;
import org.apache.commons.net.ftp.FTPSClient;

import com.ftpanimeplayer.sync.domain.FtpServerConfig;
import com.ftpanimeplayer.sync.domain.RemoteEntry;

/**
 * FTP / FTPS implementation backed by Apache commons-net. Mirrors
 * {@code src/main/ftp/ftp.ts}.
 */
class BasicFtpClient implements FtpClient {

    private final FtpServerConfig cfg;
    private FTPClient client;

    BasicFtpClient(FtpServerConfig cfg) {
        this.cfg = cfg;
    }

    @Override
    public void connect() throws IOException {
        FTPClient c;
        if (cfg.getProtocol() == com.ftpanimeplayer.sync.domain.FtpProtocol.ftps) {
            FTPSClient ftps = new FTPSClient(Boolean.TRUE.equals(cfg.getSecure()));
            if (Boolean.TRUE.equals(cfg.getAllowSelfSigned())) {
                ftps.setTrustManager(trustAll());
            }
            c = ftps;
        } else {
            c = new FTPClient();
        }
        c.setConnectTimeout(20_000);
        c.setDefaultTimeout(30_000);
        c.connect(cfg.getHost(), cfg.getPort() > 0 ? cfg.getPort() : 21);
        int reply = c.getReplyCode();
        if (!FTPReply.isPositiveCompletion(reply)) {
            c.disconnect();
            throw new IOException("FTP server refused connection: " + reply);
        }
        if (!c.login(nullToEmpty(cfg.getUsername()), nullToEmpty(cfg.getPassword()))) {
            String msg = c.getReplyString();
            c.logout();
            c.disconnect();
            throw new IOException("login failed: " + msg);
        }
        c.setFileType(FTP.BINARY_FILE_TYPE);
        c.enterLocalPassiveMode();
        this.client = c;
    }

    @Override
    public List<RemoteEntry> list(String path) throws IOException {
        requireConnected();
        FTPFile[] files = client.listFiles(path);
        List<RemoteEntry> out = new ArrayList<>(files.length);
        for (FTPFile f : files) {
            if (f == null) continue;
            String name = f.getName();
            if (".".equals(name) || "..".equals(name)) continue;
            RemoteEntry.Type type = f.isDirectory() ? RemoteEntry.Type.directory : RemoteEntry.Type.file;
            long modMs = f.getTimestamp() != null ? f.getTimestamp().getTimeInMillis() : 0L;
            String child = path.endsWith("/") ? path + name : path + "/" + name;
            out.add(new RemoteEntry(name, child, type, f.getSize(), modMs > 0 ? modMs : null));
        }
        return out;
    }

    @Override
    public long size(String path) throws IOException {
        requireConnected();
        // commons-net's getSize() issues the SIZE command directly; fall back
        // to listFiles() if the server doesn't support SIZE.
        try {
            String sizeStr = client.getSize(path);
            if (sizeStr != null) return Long.parseLong(sizeStr.trim());
        } catch (IOException | NumberFormatException ignored) {
            // fall through
        }
        FTPFile[] files = client.listFiles(path);
        if (files.length == 0) throw new IOException("file not found: " + path);
        return files[0].getSize();
    }

    @Override
    public InputStream openReadStream(String path, long start, long end) throws IOException {
        requireConnected();
        if (start > 0) {
            client.setRestartOffset(start);
        }
        InputStream raw = client.retrieveFileStream(path);
        if (raw == null) {
            throw new IOException("retrieveFileStream returned null: " + client.getReplyString());
        }
        InputStream stream = raw;
        if (end >= start && end > 0) {
            long length = end - Math.max(start, 0) + 1;
            stream = new BoundedInputStream(raw, length);
        }
        // commons-net expects a completePendingCommand() after the stream
        // closes; wrap so callers don't have to remember.
        return new CompletingInputStream(stream, client);
    }

    @Override
    public void disconnect() {
        if (client == null) return;
        try {
            if (client.isConnected()) {
                try { client.logout(); } catch (IOException ignored) { }
                client.disconnect();
            }
        } catch (IOException ignored) {
            // ignore
        } finally {
            client = null;
        }
    }

    private void requireConnected() throws IOException {
        if (client == null || !client.isConnected()) {
            throw new IOException("ftp client is not connected");
        }
    }

    private static String nullToEmpty(String s) { return s == null ? "" : s; }

    private static TrustManager trustAll() {
        return new X509TrustManager() {
            @Override public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            @Override public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            @Override public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        };
    }

    // SSLContext holder kept around so SpotBugs doesn't whine about unused
    // imports when users choose not to use self-signed certs.
    @SuppressWarnings("unused")
    private static final Class<?> _keepSslContext = SSLContext.class;

    /** Caps an upstream stream at N bytes so byte-range queries don't overread. */
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

    /** Calls {@link FTPClient#completePendingCommand()} on close. */
    private static final class CompletingInputStream extends FilterInputStream {
        private final FTPClient owner;

        CompletingInputStream(InputStream in, FTPClient owner) {
            super(in);
            this.owner = owner;
        }

        @Override
        public void close() throws IOException {
            try {
                super.close();
            } finally {
                try { owner.completePendingCommand(); } catch (IOException ignored) { }
            }
        }
    }
}
