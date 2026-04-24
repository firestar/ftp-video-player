package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code FtpServerConfig} in {@code src/shared/types.ts}. */
public class FtpServerConfig {
    private String id;
    private String name;
    private FtpProtocol protocol;
    private String host;
    private int port;
    private String username;
    private String password;
    private Boolean secure;
    private Boolean allowSelfSigned;
    private Integer maxConcurrentConnections;

    public String getId() { return id; }
    public void setId(String v) { this.id = v; }
    public String getName() { return name; }
    public void setName(String v) { this.name = v; }
    public FtpProtocol getProtocol() { return protocol; }
    public void setProtocol(FtpProtocol v) { this.protocol = v; }
    public String getHost() { return host; }
    public void setHost(String v) { this.host = v; }
    public int getPort() { return port; }
    public void setPort(int v) { this.port = v; }
    public String getUsername() { return username; }
    public void setUsername(String v) { this.username = v; }
    public String getPassword() { return password; }
    public void setPassword(String v) { this.password = v; }
    public Boolean getSecure() { return secure; }
    public void setSecure(Boolean v) { this.secure = v; }
    public Boolean getAllowSelfSigned() { return allowSelfSigned; }
    public void setAllowSelfSigned(Boolean v) { this.allowSelfSigned = v; }
    public Integer getMaxConcurrentConnections() { return maxConcurrentConnections; }
    public void setMaxConcurrentConnections(Integer v) { this.maxConcurrentConnections = v; }
}
