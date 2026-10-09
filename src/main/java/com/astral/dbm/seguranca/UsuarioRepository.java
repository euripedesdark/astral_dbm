package com.astral.dbm.seguranca;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.util.List;

/**
 * Persistência da linha de {@code dbm_usuario} (14.1).
 *
 * A linha NÃO autentica ninguém: ela existe só depois de um token válido e
 * carrega perfil/preferência. Por isso não há hash nem coluna de senha (§0.25).
 */
@Repository
public class UsuarioRepository {

    private final JdbcTemplate jdbc;

    public UsuarioRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record UsuarioRow(Long id, String username, String source, String displayName, Timestamp ultimoAcessoEm) {
    }

    /** Garante a linha do usuário e atualiza {@code ultimo_acesso_em}. */
    public Long garantir(String username, String source) {
        Long existente = idPorUsername(username);
        if (existente != null) {
            jdbc.update("""
                    update dbm_usuario
                       set source = ?, ultimo_acesso_em = NOW(), updated_at = NOW()
                     where id = ?
                    """, source, existente);
            return existente;
        }
        return jdbc.queryForObject("""
                insert into dbm_usuario (username, source, display_name, ultimo_acesso_em)
                values (?, ?, ?, NOW())
                returning id
                """, Long.class, username, source, username);
    }

    public Long idPorUsername(String username) {
        List<Long> r = jdbc.query("""
                select id from dbm_usuario
                 where lower(username) = lower(?)
                 order by id
                 limit 1
                """, (rs, n) -> rs.getLong(1), username);
        return r.isEmpty() ? null : r.get(0);
    }

    public UsuarioRow porUsername(String username) {
        List<UsuarioRow> r = jdbc.query("""
                select id, username, source, display_name, ultimo_acesso_em
                  from dbm_usuario
                 where lower(username) = lower(?)
                 order by id
                 limit 1
                """, (rs, n) -> new UsuarioRow(
                rs.getLong("id"),
                rs.getString("username"),
                rs.getString("source"),
                rs.getString("display_name"),
                rs.getTimestamp("ultimo_acesso_em")), username);
        return r.isEmpty() ? null : r.get(0);
    }
}
