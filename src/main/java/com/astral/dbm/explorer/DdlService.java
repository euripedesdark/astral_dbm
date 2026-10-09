package com.astral.dbm.explorer;

import com.astral.dbm.common.Ident;
import com.astral.dbm.conexao.ConexaoService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Geração de DDL a partir do estado existente (spec §10.3, menu "Objetos" §9).
 *
 * Reconstrói o CREATE TABLE (com sequences, colunas, restrições e índices) a
 * partir de pg_attribute/pg_constraint/pg_index, e a view via pg_get_viewdef.
 * Só lê — nunca executa nada.
 */
@Service
public class DdlService {

    private final ConexaoService conexoes;

    public DdlService(ConexaoService conexoes) {
        this.conexoes = conexoes;
    }

    public Map<String, Object> gerar(UUID id, String schema, String nome, String tipo) {
        JdbcTemplate j = conexoes.jdbcDe(id);
        String reg = Ident.quote(schema) + "." + Ident.quote(nome);
        String ddl;
        String efetivo;
        if ("view".equalsIgnoreCase(tipo)) {
            String def = j.queryForObject(
                    "select pg_get_viewdef(cast(? as regclass), true)", String.class, reg);
            ddl = "CREATE OR REPLACE VIEW " + reg + " AS\n" + (def == null ? "" : def.strip());
            efetivo = "view";
        } else {
            ddl = tabela(j, reg);
            efetivo = "tabela";
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("schema", schema);
        m.put("nome", nome);
        m.put("tipo", efetivo);
        m.put("ddl", ddl);
        return m;
    }

    private String tabela(JdbcTemplate j, String reg) {
        // Sequences possuídas pela tabela (serial/identity) — emitidas antes do CREATE TABLE.
        List<Map<String, Object>> sequencias = j.queryForList("""
                select n.nspname as schema,
                       s.relname as nome,
                       a.attname as coluna,
                       pg_catalog.format_type(sq.seqtypid, null) as tipo,
                       sq.seqstart as inicio,
                       sq.seqincrement as incremento,
                       sq.seqmin as minimo,
                       sq.seqmax as maximo,
                       sq.seqcache as cache,
                       sq.seqcycle as ciclo
                  from pg_class s
                  join pg_sequence sq on sq.seqrelid = s.oid
                  join pg_namespace n on n.oid = s.relnamespace
                  join pg_depend d on d.objid = s.oid
                                  and d.classid = 'pg_class'::regclass
                                  and d.refobjsubid > 0
                  join pg_class t on t.oid = d.refobjid
                  join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
                 where t.oid = cast(? as regclass)
                 order by s.relname
                """, reg);
        Map<String, String> seqPorColuna = new LinkedHashMap<>();
        for (Map<String, Object> s : sequencias) {
            seqPorColuna.put(String.valueOf(s.get("coluna")),
                    Ident.quote(String.valueOf(s.get("schema"))) + "."
                            + Ident.quote(String.valueOf(s.get("nome"))));
        }

        List<Map<String, Object>> colunas = j.queryForList("""
                select a.attname as nome,
                       pg_catalog.format_type(a.atttypid, a.atttypmod) as tipo,
                       a.attnotnull as notnull,
                       pg_get_expr(d.adbin, d.adrelid) as padrao
                  from pg_attribute a
                  left join pg_attrdef d
                    on d.adrelid = a.attrelid and d.adnum = a.attnum
                 where a.attrelid = cast(? as regclass)
                   and a.attnum > 0 and not a.attisdropped
                 order by a.attnum
                """, reg);

        List<Map<String, Object>> restricoes = j.queryForList("""
                select conname as nome, pg_get_constraintdef(oid, true) as definicao
                  from pg_constraint
                 where conrelid = cast(? as regclass)
                   and contype in ('p','u','f','c','x')
                 order by case contype when 'p' then 0 when 'u' then 1 when 'f' then 2 else 3 end,
                          conname
                """, reg);

        List<Map<String, Object>> indices = j.queryForList("""
                select c.relname as nome, pg_get_indexdef(i.indexrelid) as definicao
                  from pg_index i
                  join pg_class c on c.oid = i.indexrelid
                 where i.indrelid = cast(? as regclass)
                   and not exists (select 1 from pg_constraint con where con.conindid = i.indexrelid)
                 order by c.relname
                """, reg);

        StringBuilder sb = new StringBuilder();
        List<String> apropriacoes = new ArrayList<>();
        for (Map<String, Object> s : sequencias) {
            String sn = Ident.quote(String.valueOf(s.get("schema"))) + "."
                    + Ident.quote(String.valueOf(s.get("nome")));
            boolean ciclo = Boolean.TRUE.equals(s.get("ciclo"));
            sb.append("CREATE SEQUENCE ").append(sn)
                    .append("\n    AS ").append(s.get("tipo"))
                    .append(" START WITH ").append(s.get("inicio"))
                    .append(" INCREMENT BY ").append(s.get("incremento"))
                    .append(" MINVALUE ").append(s.get("minimo"))
                    .append(" MAXVALUE ").append(s.get("maximo"))
                    .append(" CACHE ").append(s.get("cache"))
                    .append(ciclo ? " CYCLE" : " NO CYCLE").append(";\n\n");
            // OWNED BY só pode rodar depois que a tabela existe.
            apropriacoes.add("ALTER SEQUENCE " + sn + " OWNED BY "
                    + reg + "." + Ident.quote(String.valueOf(s.get("coluna"))) + ";");
        }

        List<String> linhas = new ArrayList<>();
        for (Map<String, Object> c : colunas) {
            String coluna = String.valueOf(c.get("nome"));
            StringBuilder l = new StringBuilder("    ")
                    .append(Ident.quote(coluna)).append(" ").append(c.get("tipo"));
            if (Boolean.TRUE.equals(c.get("notnull"))) {
                l.append(" NOT NULL");
            }
            if (c.get("padrao") != null) {
                l.append(" DEFAULT ").append(c.get("padrao"));
            } else if (seqPorColuna.containsKey(coluna)) {
                // Coluna identity: a sequence existe, mas o default não está em pg_attrdef.
                l.append(" DEFAULT nextval('").append(seqPorColuna.get(coluna).replace("'", "''"))
                        .append("'::regclass)");
            }
            linhas.add(l.toString());
        }
        for (Map<String, Object> r : restricoes) {
            linhas.add("    CONSTRAINT " + Ident.quote(String.valueOf(r.get("nome")))
                    + " " + r.get("definicao"));
        }

        sb.append("CREATE TABLE ").append(reg).append(" (\n")
                .append(String.join(",\n", linhas)).append("\n);");
        for (String a : apropriacoes) {
            sb.append("\n\n").append(a);
        }
        for (Map<String, Object> i : indices) {
            sb.append("\n\n").append(i.get("definicao")).append(";");
        }
        return sb.toString();
    }
}
