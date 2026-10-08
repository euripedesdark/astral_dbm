package com.astral.dbm.conexao;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Persistência das conexões e do catálogo de drivers no banco PRÓPRIO do DBM.
 */
@Repository
public class ConexaoRepository {

    private final JdbcTemplate jdbc;

    public ConexaoRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record ConexaoRow(
            Long id,
            UUID uuid,
            String nome,
            Long driverId,
            String driverNome,
            String driverJdbcClass,
            String url,
            String usuarioBd,
            String esquemaPadrao,
            Long grupoId,
            boolean global,
            boolean somenteLeitura,
            int timeoutMs,
            String grupoNome) {
    }

    public record DriverRow(
            Long id,
            UUID uuid,
            String nome,
            String fabricante,
            String versao,
            String jdbcClass,
            String jdbcUrlTemplate,
            String suportadoNivel,
            boolean ativo) {
    }

    private static final RowMapper<ConexaoRow> MAP_CONEXAO = (rs, n) -> new ConexaoRow(
            rs.getLong("id"),
            rs.getObject("uuid", UUID.class),
            rs.getString("nome"),
            rs.getLong("driver_id"),
            rs.getString("driver_nome"),
            rs.getString("jdbc_class"),
            rs.getString("url"),
            rs.getString("usuario_bd"),
            rs.getString("esquema_padrao"),
            rs.getObject("grupo_id") == null ? null : rs.getLong("grupo_id"),
            rs.getBoolean("global"),
            rs.getBoolean("somente_leitura"),
            rs.getInt("timeout_ms"),
            rs.getString("grupo_nome"));

    private static final RowMapper<DriverRow> MAP_DRIVER = (rs, n) -> new DriverRow(
            rs.getLong("id"),
            rs.getObject("uuid", UUID.class),
            rs.getString("nome"),
            rs.getString("fabricante"),
            rs.getString("versao"),
            rs.getString("jdbc_class"),
            rs.getString("jdbc_url_template"),
            rs.getString("suportado_nivel"),
            rs.getBoolean("ativo"));

    public List<ConexaoRow> listar() {
        return jdbc.query("""
                select c.id, c.uuid, c.nome, c.driver_id, d.nome as driver_nome,
                       d.jdbc_class, c.url, c.usuario_bd, c.esquema_padrao,
                       c.grupo_id, c.global, c.somente_leitura, c.timeout_ms,
                       g.nome as grupo_nome
                  from dbm_conexao c
                  join dbm_driver d on d.id = c.driver_id
                  left join dbm_grupo_conexao g on g.id = c.grupo_id
                 order by g.ordem nulls last, c.nome
                """, MAP_CONEXAO);
    }

    public ConexaoRow porUuid(UUID uuid) {
        List<ConexaoRow> r = jdbc.query("""
                select c.id, c.uuid, c.nome, c.driver_id, d.nome as driver_nome,
                       d.jdbc_class, c.url, c.usuario_bd, c.esquema_padrao,
                       c.grupo_id, c.global, c.somente_leitura, c.timeout_ms,
                       g.nome as grupo_nome
                  from dbm_conexao c
                  join dbm_driver d on d.id = c.driver_id
                  left join dbm_grupo_conexao g on g.id = c.grupo_id
                 where c.uuid = ?
                """, MAP_CONEXAO, uuid);
        return r.isEmpty() ? null : r.get(0);
    }

    /** Bytes cifrados da senha do banco-alvo (nunca sai para a API). */
    public byte[] senhaCifrada(UUID uuid) {
        List<byte[]> r = jdbc.query("select senha_cifrada from dbm_conexao where uuid = ?",
                (rs, n) -> rs.getBytes(1), uuid);
        return r.isEmpty() ? null : r.get(0);
    }

    public Long idDoUsuarioPadrao() {
        List<Long> r = jdbc.query("select id from dbm_usuario order by id limit 1",
                (rs, n) -> rs.getLong(1));
        if (!r.isEmpty()) {
            return r.get(0);
        }
        // Base sem login (0.19 pendente): cria o usuário-sistema.
        return jdbc.queryForObject("""
                insert into dbm_usuario (username, source, display_name)
                values ('dbm', 'LOCAL', 'Usuário local do DBM')
                returning id
                """, Long.class);
    }

    public void inserir(String nome, Long driverId, String url, String usuarioBd,
                        byte[] senhaCifrada, String esquemaPadrao, Long grupoId,
                        boolean global, boolean somenteLeitura, int timeoutMs, Long criadoPor) {
        jdbc.update("""
                insert into dbm_conexao
                    (nome, driver_id, url, usuario_bd, senha_cifrada, esquema_padrao,
                     grupo_id, global, somente_leitura, timeout_ms, criado_por)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, nome, driverId, url, usuarioBd, senhaCifrada, esquemaPadrao,
                grupoId, global, somenteLeitura, timeoutMs, criadoPor);
    }

    public int atualizar(UUID uuid, String nome, Long driverId, String url, String usuarioBd,
                         byte[] senhaCifrada, String esquemaPadrao, Long grupoId,
                         boolean global, boolean somenteLeitura, int timeoutMs) {
        if (senhaCifrada == null) {
            return jdbc.update("""
                    update dbm_conexao
                       set nome = ?, driver_id = ?, url = ?, usuario_bd = ?,
                           esquema_padrao = ?, grupo_id = ?, global = ?,
                           somente_leitura = ?, timeout_ms = ?, updated_at = NOW()
                     where uuid = ?
                    """, nome, driverId, url, usuarioBd, esquemaPadrao, grupoId,
                    global, somenteLeitura, timeoutMs, uuid);
        }
        return jdbc.update("""
                update dbm_conexao
                   set nome = ?, driver_id = ?, url = ?, usuario_bd = ?, senha_cifrada = ?,
                       esquema_padrao = ?, grupo_id = ?, global = ?,
                       somente_leitura = ?, timeout_ms = ?, updated_at = NOW()
                 where uuid = ?
                """, nome, driverId, url, usuarioBd, senhaCifrada, esquemaPadrao, grupoId,
                global, somenteLeitura, timeoutMs, uuid);
    }

    public int remover(UUID uuid) {
        return jdbc.update("delete from dbm_conexao where uuid = ?", uuid);
    }

    public List<DriverRow> listarDrivers() {
        return jdbc.query("""
                select id, uuid, nome, fabricante, versao, jdbc_class,
                       jdbc_url_template, suportado_nivel, ativo
                  from dbm_driver
                 where ativo = true
                 order by fabricante, versao desc
                """, MAP_DRIVER);
    }

    public DriverRow driverPorId(Long id) {
        List<DriverRow> r = jdbc.query("""
                select id, uuid, nome, fabricante, versao, jdbc_class,
                       jdbc_url_template, suportado_nivel, ativo
                  from dbm_driver where id = ?
                """, MAP_DRIVER, id);
        return r.isEmpty() ? null : r.get(0);
    }

    public Long driverPorFabricanteVersao(String fabricante, String versao) {
        List<Long> r = jdbc.query("select id from dbm_driver where lower(fabricante)=lower(?) and versao=?",
                (rs, n) -> rs.getLong(1), fabricante, versao);
        return r.isEmpty() ? null : r.get(0);
    }

    public List<Map<String, Object>> listarGrupos() {
        return jdbc.queryForList("select id, uuid, nome, cor, ordem from dbm_grupo_conexao order by ordem, nome");
    }
}