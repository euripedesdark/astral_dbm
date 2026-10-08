package com.astral.dbm.explorer;

import com.astral.dbm.common.DbmException;
import com.astral.dbm.conexao.ConexaoService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Catálogo do banco-alvo — o "Explorer" da spec §2.1 e a estrutura por objeto
 * de §7. Somente leitura de metadados (information_schema/pg_catalog).
 */
@Service
public class CatalogoService {

    private final ConexaoService conexoes;

    public CatalogoService(ConexaoService conexoes) {
        this.conexoes = conexoes;
    }

    public List<String> schemas(UUID id) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select schema_name
                  from information_schema.schemata
                 where schema_name not in ('pg_catalog','information_schema','pg_toast')
                 order by schema_name
                """, String.class);
    }

    public Map<String, Object> catalogo(UUID id, String schema) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        String s = schema == null || schema.isBlank() ? "public" : schema;
        List<String> tabelas = j.queryForList("""
                select table_name from information_schema.tables
                 where table_schema = ? and table_type = 'BASE TABLE'
                 order by table_name
                """, String.class, s);
        List<String> views = j.queryForList("""
                select table_name from information_schema.tables
                 where table_schema = ? and table_type = 'VIEW'
                 order by table_name
                """, String.class, s);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("schema", s);
        m.put("tabelas", tabelas);
        m.put("views", views);
        return m;
    }

    public List<Map<String, Object>> colunas(UUID id, String schema, String tabela) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select c.column_name as nome,
                       c.data_type as tipo,
                       c.character_maximum_length as tamanho,
                       c.is_nullable as nulo,
                       c.column_default as padrao
                  from information_schema.columns c
                 where c.table_schema = ? and c.table_name = ?
                 order by c.ordinal_position
                """, schema, tabela);
    }

    public List<String> chavesPrimarias(UUID id, String schema, String tabela) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select kcu.column_name
                  from information_schema.table_constraints tc
                  join information_schema.key_column_usage kcu
                    on kcu.constraint_name = tc.constraint_name
                   and kcu.table_schema = tc.table_schema
                 where tc.constraint_type = 'PRIMARY KEY'
                   and tc.table_schema = ? and tc.table_name = ?
                 order by kcu.ordinal_position
                """, String.class, schema, tabela);
    }

    public List<Map<String, Object>> indices(UUID id, String schema, String tabela) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select indexname as nome, indexdef as definicao
                  from pg_indexes
                 where schemaname = ? and tablename = ?
                 order by indexname
                """, schema, tabela);
    }

    public List<Map<String, Object>> estrangeiras(UUID id, String schema, String tabela) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        return j.queryForList("""
                select tc.constraint_name as nome,
                       kcu.column_name as coluna,
                       ccu.table_schema as ref_schema,
                       ccu.table_name as ref_tabela,
                       ccu.column_name as ref_coluna
                  from information_schema.table_constraints tc
                  join information_schema.key_column_usage kcu
                    on kcu.constraint_name = tc.constraint_name
                   and kcu.table_schema = tc.table_schema
                  join information_schema.constraint_column_usage ccu
                    on ccu.constraint_name = tc.constraint_name
                   and ccu.table_schema = tc.table_schema
                 where tc.constraint_type = 'FOREIGN KEY'
                   and tc.table_schema = ? and tc.table_name = ?
                 order by tc.constraint_name, kcu.ordinal_position
                """, schema, tabela);
    }

    /** Browse paginado em estilo IBConsole. */
    public Map<String, Object> dados(UUID id, String schema, String tabela,
                                     int pagina, int tamanho, String busca) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        int limit = Math.min(Math.max(tamanho, 1), conexoes.linhasMax());
        int offset = Math.max(pagina, 0) * limit;
        String alvo = quote(schema) + "." + quote(tabela);

        String where = "";
        List<Object> args = new ArrayList<>();
        if (busca != null && !busca.isBlank()) {
            List<String> colunasTexto = j.queryForList("""
                    select column_name from information_schema.columns
                     where table_schema = ? and table_name = ?
                       and data_type in ('character varying','text','character','uuid','name')
                    """, String.class, schema, tabela);
            if (!colunasTexto.isEmpty()) {
                StringBuilder sb = new StringBuilder(" where (");
                for (int i = 0; i < colunasTexto.size(); i++) {
                    if (i > 0) {
                        sb.append(" or ");
                    }
                    sb.append("cast(").append(quote(colunasTexto.get(i))).append(" as text) ilike ?");
                    args.add("%" + busca + "%");
                }
                sb.append(")");
                where = sb.toString();
            }
        }

        Long total = j.queryForObject("select count(*) from " + alvo + where, Long.class, args.toArray());
        List<Object> argsPagina = new ArrayList<>(args);
        args.add(limit);
        args.add(offset);
        List<Map<String, Object>> linhas = j.queryForList(
                "select * from " + alvo + where + " limit ? offset ?", args.toArray());

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("total", total == null ? 0 : total);
        m.put("pagina", pagina);
        m.put("tamanho", limit);
        m.put("linhas", linhas);
        return m;
    }

    private String quote(String ident) {
        if (ident == null || ident.isBlank()) {
            throw DbmException.invalido("Identificador vazio");
        }
        return "\"" + ident.replace("\"", "\"\"") + "\"";
    }
}