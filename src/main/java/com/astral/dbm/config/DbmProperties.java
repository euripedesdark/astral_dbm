package com.astral.dbm.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Parâmetros do DBM (spec §0.11: cache/pool é recurso do SERVIDOR).
 */
@ConfigurationProperties(prefix = "dbm")
public class DbmProperties {

    private final Pool pool = new Pool();
    private int linhasMax = 1000;

    public Pool getPool() {
        return pool;
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
}