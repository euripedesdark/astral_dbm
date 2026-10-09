package com.astral.dbm.explorer;

import com.astral.dbm.common.DbmException;
import com.astral.dbm.common.Ident;
import com.astral.dbm.conexao.ConexaoService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Administração de bancos e schemas do alvo (spec §4 e menus "Bancos"/"Schemas").
 *
 * Escrita recusa conexão somente-leitura; DROP exige confirmação digitada com o
 * nome exato do objeto (§4.1/§4.2). CREATE DATABASE não roda em transação —
 * por isso é executado no autocommit do pool.
 */
@Service
public class BancosService {

    private final ConexaoService conexoes;

    public BancosService(ConexaoService conexoes) {
        this.conexoes = conexoes;
    }

    /** Lista de bancos do servidor (spec menu "Bancos", §4.1). */
    public List<Map<String, Object>> listar(UUID id) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select d.datname as nome,
                       pg_get_userbyid(d.datdba) as dono,
                       pg_encoding_to_char(d.encoding) as codificacao,
                       d.datcollate as collate,
                       d.datctype as ctype,
                       d.datallowconn as permite_conexao,
                       d.datconnlimit as limite_conexao,
                       pg_size_pretty(pg_database_size(d.datname)) as tamanho
                  from pg_database d
                 where not d.datistemplate
                 order by d.datname
                """);
    }

    /** SQL de CREATE DATABASE, sem executar (preview da UI — §4.1). */
    public String sqlCriarBanco(String nome, String dono, String encoding, String template) {
        exigirNome(nome);
        StringBuilder sb = new StringBuilder("CREATE DATABASE ").append(Ident.quote(nome));
        if (template != null && !template.isBlank()) {
            sb.append(" TEMPLATE ").append(Ident.quote(template));
        }
        if (dono != null && !dono.isBlank()) {
            sb.append(" OWNER ").append(Ident.quote(dono));
        }
        if (encoding != null && !encoding.isBlank()) {
            sb.append(" ENCODING '").append(encoding.replace("'", "''")).append("'");
        }
        return sb.toString();
    }

    public Map<String, Object> criarBanco(UUID id, String nome, String dono, String encoding,
                                          String template, boolean confirmar) {
        exigirEscrita(id);
        if (!confirmar) {
            throw DbmException.confirmacao("Criação de banco exige confirmação.");
        }
        String sql = sqlCriarBanco(nome, dono, encoding, template);
        conexoes.jdbcDe(id).execute(sql);
        return resultado(sql);
    }

    public Map<String, Object> droparBanco(UUID id, String nome, String confirmacao, boolean forcar) {
        exigirEscrita(id);
        exigirNome(nome);
        if (!nome.equals(confirmacao)) {
            throw DbmException.confirmacao("Digite o nome do banco para confirmar o DROP.");
        }
        JdbcTemplate j = conexoes.jdbcDe(id);
        String atual = j.queryForObject("select current_database()", String.class);
        if (nome.equals(atual)) {
            throw DbmException.invalido(
                    "Não é possível dropar o banco ao qual se está conectado (" + atual + ").");
        }
        if (forcar) {
            j.queryForList("select pg_terminate_backend(pid) from pg_stat_activity "
                    + "where datname = ? and pid <> pg_backend_pid()", nome);
        }
        String sql = "DROP DATABASE " + Ident.quote(nome);
        j.execute(sql);
        return resultado(sql);
    }

    public Map<String, Object> criarSchema(UUID id, String nome, boolean confirmar) {
        exigirEscrita(id);
        exigirNome(nome);
        if (!confirmar) {
            throw DbmException.confirmacao("Criação de schema exige confirmação.");
        }
        String sql = "CREATE SCHEMA " + Ident.quote(nome);
        conexoes.jdbcDe(id).execute(sql);
        return resultado(sql);
    }

    public Map<String, Object> droparSchema(UUID id, String nome, String confirmacao, boolean cascade) {
        exigirEscrita(id);
        exigirNome(nome);
        if (!nome.equals(confirmacao)) {
            throw DbmException.confirmacao("Digite o nome do schema para confirmar o DROP.");
        }
        String sql = "DROP SCHEMA " + Ident.quote(nome) + (cascade ? " CASCADE" : " RESTRICT");
        conexoes.jdbcDe(id).execute(sql);
        return resultado(sql);
    }

    private Map<String, Object> resultado(String sql) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sql", sql);
        return m;
    }

    private void exigirEscrita(UUID id) {
        if (conexoes.somenteLeitura(id)) {
            throw new DbmException("SOMENTE_LEITURA",
                    "Conexão marcada como somente leitura: a operação foi recusada.");
        }
    }

    private void exigirNome(String nome) {
        if (nome == null || nome.isBlank()) {
            throw DbmException.invalido("Informe o nome.");
        }
    }
}
