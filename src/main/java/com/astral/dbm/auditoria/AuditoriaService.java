package com.astral.dbm.auditoria;

import com.astral.dbm.conexao.ConexaoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Trilha de SQL (spec 7.3 / tabela dbm_execucao).
 *
 * Best-effort de propósito: falha de auditoria não pode derrubar a operação
 * que está sendo auditada (0.20 — fonte com falha não é ausência de dado).
 */
@Service
public class AuditoriaService {

    private static final Logger log = LoggerFactory.getLogger(AuditoriaService.class);

    private final JdbcTemplate jdbc;
    private final ConexaoRepository conexoes;

    public AuditoriaService(JdbcTemplate jdbc, ConexaoRepository conexoes) {
        this.jdbc = jdbc;
        this.conexoes = conexoes;
    }

    public void registrar(long conexaoId, String sql, String tipo, String status,
                          Long linhasAfetadas, long duracaoMs, String erro) {
        try {
            Long usuario = conexoes.idDoUsuarioPadrao();
            jdbc.update("""
                    insert into dbm_execucao
                        (usuario_id, conexao_id, sql_text, sql_hash, norm_sql,
                         tipo, status, linhas_afetadas, duracao_ms, erro)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    usuario, conexaoId, sql, hash(sql), normalizar(sql),
                    tipo, status, linhasAfetadas, duracaoMs, erro);
        } catch (Exception e) {
            log.warn("Falha ao gravar auditoria de SQL (execução seguiu): {}", e.getMessage());
        }
    }

    public long conexaoInterna(UUID uuid) {
        ConexaoRepository.ConexaoRow c = conexoes.porUuid(uuid);
        return c == null ? -1 : c.id();
    }

    private static String hash(String sql) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(sql.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(d);
        } catch (Exception e) {
            return null;
        }
    }

    /** Troca literais por ? para agrupar por identidade (7.3). */
    static String normalizar(String sql) {
        if (sql == null) {
            return null;
        }
        String s = sql.replaceAll("'(?:''|[^'])*'", "?");
        s = s.replaceAll("\\b\\d+\\b", "?");
        return s.length() > 4000 ? s.substring(0, 4000) : s;
    }

    public static String tipo(String sql) {
        if (sql == null) {
            return null;
        }
        String p = sql.strip().toLowerCase(java.util.Locale.ROOT);
        if (p.startsWith("select") || p.startsWith("with") || p.startsWith("show")
                || p.startsWith("explain") || p.startsWith("table") || p.startsWith("values")) {
            return "SELECT";
        }
        if (p.startsWith("insert") || p.startsWith("update") || p.startsWith("delete")
                || p.startsWith("merge") || p.startsWith("truncate")) {
            return "DML";
        }
        if (p.startsWith("grant") || p.startsWith("revoke")) {
            return "DCL";
        }
        return "DDL";
    }
}