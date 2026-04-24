package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code RemoteEntry} in {@code src/shared/types.ts}. */
public class RemoteEntry {
    public enum Type { file, directory }

    private String name;
    private String path;
    private Type type;
    private long size;
    private Long modifiedAt;

    public RemoteEntry() {}

    public RemoteEntry(String name, String path, Type type, long size, Long modifiedAt) {
        this.name = name;
        this.path = path;
        this.type = type;
        this.size = size;
        this.modifiedAt = modifiedAt;
    }

    public String getName() { return name; }
    public void setName(String v) { this.name = v; }
    public String getPath() { return path; }
    public void setPath(String v) { this.path = v; }
    public Type getType() { return type; }
    public void setType(Type v) { this.type = v; }
    public long getSize() { return size; }
    public void setSize(long v) { this.size = v; }
    public Long getModifiedAt() { return modifiedAt; }
    public void setModifiedAt(Long v) { this.modifiedAt = v; }
}
