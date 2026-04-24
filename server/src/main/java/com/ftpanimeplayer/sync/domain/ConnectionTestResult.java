package com.ftpanimeplayer.sync.domain;

/** Mirrors {@code ConnectionTestResult} in {@code src/shared/types.ts}. */
public class ConnectionTestResult {
    private boolean ok;
    private String error;

    public ConnectionTestResult() {}

    public ConnectionTestResult(boolean ok, String error) {
        this.ok = ok;
        this.error = error;
    }

    public boolean isOk() { return ok; }
    public void setOk(boolean v) { this.ok = v; }
    public String getError() { return error; }
    public void setError(String v) { this.error = v; }
}
