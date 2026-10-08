package com.astral.dbm.pool;

import com.astral.dbm.config.DbmProperties;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Pool dos bancos-ALVO (spec §0.11: pool e cache de driver são recurso do
 * SERVIDOR, nunca do navegador).
 *
 * Um {@link HikariDataSource} por conexão cadastrada, aberto sob demanda e
 * descartado quando a conexão é alterada ou removida.
 */
@Component
public class PoolConexoes {

    private static final Logger log = LoggerFactory.getLogger(PoolConexoes.class);

    private final DbmProperties props;
    private final ConcurrentHashMap<UUID, HikariDataSource> pools = new ConcurrentHashMap<>();

    public PoolConexoes(DbmProperties props) {
        this.props = props;
    }

    /** Testa uma configuração JDBC e devolve a versão do servidor. */
    public String testar(String jdbcClass, String url, String usuario, String senha, int timeoutMs) {
        carregarDriver(jdbcClass);
        java.util.Properties p = new java.util.Properties();
        p.put("user", usuario == null ? "" : usuario);
        p.put("password", senha == null ? "" : senha);
        if (timeoutMs > 0) {
            p.put("connectTimeout", String.valueOf(timeoutMs));
            p.put("loginTimeout", String.valueOf((timeoutMs + 999) / 1000));
        }
        try (java.sql.Connection cn = java.sql.DriverManager.getConnection(url, p)) {
            java.sql.DatabaseMetaData md = cn.getMetaData();
            return md.getDatabaseProductName() + " " + md.getDatabaseProductVersion()
                    + " (" + md.getDriverName() + " " + md.getDriverVersion() + ")";
        } catch (Exception e) {
            throw new com.astral.dbm.common.DbmException("CONEXAO_FALHOU",
                    "Não foi possível conectar: " + causa(e));
        }
    }

    public HikariDataSource dataSource(UUID id, String jdbcClass, String url, String usuario,
                                       String senha, int timeoutMs) {
        return pools.computeIfAbsent(id, k -> {
            carregarDriver(jdbcClass);
            HikariConfig cfg = new HikariConfig();
            cfg.setPoolName("dbm-alvo-" + k.toString().substring(0, 8));
            cfg.setJdbcUrl(url);
            cfg.setUsername(usuario);
            cfg.setPassword(senha);
            cfg.setDriverClassName(jdbcClass);
            cfg.setMaximumPoolSize(Math.max(1, props.getPool().getMaxSize()));
            cfg.setMinimumIdle(0);
            cfg.setIdleTimeout(props.getPool().getIdleTimeoutMs());
            cfg.setConnectionTimeout(timeoutMs > 0 ? timeoutMs : 30_000);
            // O pool não deve bloquear; catálogo e browse são curtos.
            cfg.setConnectionTestQuery("select 1");
            return new HikariDataSource(cfg);
        });
    }

    public void invalidar(UUID id) {
        HikariDataSource ds = pools.remove(id);
        if (ds != null) {
            try {
                ds.close();
            } catch (Exception e) {
                log.debug("Falha ao fechar pool {}: {}", id, e.getMessage());
            }
        }
    }

    private void carregarDriver(String jdbcClass) {
        if (jdbcClass == null || jdbcClass.isBlank()) {
            throw new com.astral.dbm.common.DbmException("DRIVER_INVALIDO", "Classe JDBC do driver não informada");
        }
        try {
            Class.forName(jdbcClass);
        } catch (ClassNotFoundException e) {
            throw new com.astral.dbm.common.DbmException("DRIVER_AUSENTE",
                    "Driver JDBC '" + jdbcClass + "' não está no classpath do servidor");
        }
    }

    private String causa(Throwable t) {
        Throwable atual = t;
        while (atual.getCause() != null && atual.getCause() != atual) {
            atual = atual.getCause();
        }
        return atual.getMessage() == null ? atual.toString() : atual.getMessage();
    }
}