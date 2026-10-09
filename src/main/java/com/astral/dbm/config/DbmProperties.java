package com.astral.dbm.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Parâmetros do DBM (spec §0.11: cache/pool é recurso do SERVIDOR).
 */
@ConfigurationProperties(prefix = "dbm")
public class DbmProperties {

    private final Pool pool = new Pool();
    private final Auth auth = new Auth();
    private int linhasMax = 1000;

    public Pool getPool() {
        return pool;
    }

    public Auth getAuth() {
        return auth;
    }

    public int getLinhasMax() {
        return linhasMax;
    }

    public void setLinhasMax(int linhasMax) {
        this.linhasMax = linhasMax;
    }

    public static class Pool {
        private int maxSize = 4;
        private long idleTimeoutMs = 60_000;

        public int getMaxSize() {
            return maxSize;
        }

        public void setMaxSize(int maxSize) {
            this.maxSize = maxSize;
        }

        public long getIdleTimeoutMs() {
            return idleTimeoutMs;
        }

        public void setIdleTimeoutMs(long idleTimeoutMs) {
            this.idleTimeoutMs = idleTimeoutMs;
        }
    }

    /**
     * Integração com o Auth Service (§0.25). Chega DESLIGADA para a base
     * continuar testável em rede local; em produção, `dbm.auth.enabled=true`
     * exige o Bearer do Auth Service na API.
     */
    public static class Auth {

        private boolean enabled = false;
        private String url = "http://127.0.0.1:8181";
        private String mePath = "/api/v1/identity/me";
        private long cacheSeconds = 60;
        private long timeoutMs = 3000;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public String getMePath() {
            return mePath;
        }

        public void setMePath(String mePath) {
            this.mePath = mePath;
        }

        public long getCacheSeconds() {
            return cacheSeconds;
        }

        public void setCacheSeconds(long cacheSeconds) {
            this.cacheSeconds = cacheSeconds;
        }

        public long getTimeoutMs() {
            return timeoutMs;
        }

        public void setTimeoutMs(long timeoutMs) {
            this.timeoutMs = timeoutMs;
        }
    }
}