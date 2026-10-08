package com.astral.dbm.query;

import com.astral.dbm.common.DbmException;
import com.astral.dbm.conexao.ConexaoService;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Editor/console SQL (spec §8) em modo IBConsole: executa, devolve grade e
 * obriga confirmação para escrita (defesa em profundidade — §0.7).
 */
@Service
public class QueryService {

    private static final Set<String> LEITURA = Set.of(
            "select", "with", "show", "explain", "describe", "desc", "values", "table");

    private final ConexaoService conexoes;

    public QueryService(ConexaoService conexoes) {
        this.conexoes = conexoes;
    }

    public Map<String, Object> executar(UUID id, String sql, boolean confirmar) {
        if (sql == null || sql.isBlank()) {
            throw DbmException.invalido("SQL vazio");
        }
        boolean escrita = ehEscrita(sql);
        if (escrita) {
            if (conexoes.somenteLeitura(id)) {
                throw new DbmException("SOMENTE_LEITURA",
                        "Conexão marcada como somente leitura: a instrução foi recusada.");
            }
            if (!confirmar) {
                throw DbmException.confirmacao(
                        "Esta instrução altera dados ou estrutura. Confirme para executar.");
            }
        }

        JdbcTemplate j = conexoes.jdbcDe(id);
        int max = conexoes.linhasMax();

        return j.execute((ConnectionCallback<Map<String, Object>>) cn -> {
            boolean autoCommitOriginal = cn.getAutoCommit();
            if (escrita) {
                cn.setAutoCommit(false);
            }
            List<Map<String, Object>> resultados = new ArrayList<>();
            Map<String, Object> ultimo = new LinkedHashMap<>();
            try (Statement st = cn.createStatement()) {
                st.setMaxRows(max);
                for (String parte : dividir(sql)) {
                    if (st.execute(parte)) {
                        try (ResultSet rs = st.getResultSet()) {
                            ultimo = grade(rs);
                        }
                    } else {
                        Map<String, Object> m = new LinkedHashMap<>();
                        m.put("tipo", "comando");
                        m.put("comando", primeiraPalavra(parte).toUpperCase(Locale.ROOT));
                        m.put("linhasAfetadas", st.getUpdateCount());
                        ultimo = m;
                    }
                    resultados.add(ultimo);
                }
                if (escrita) {
                    cn.commit();
                }
            } catch (Exception e) {
                if (escrita) {
                    try {
                        cn.rollback();
                    } catch (Exception ignore) {
                        // best-effort
                    }
                }
                throw new DbmException("ERRO_SQL", e.getMessage());
            } finally {
                if (escrita) {
                    try {
                        cn.setAutoCommit(autoCommitOriginal);
                    } catch (Exception ignore) {
                        // ignora
                    }
                }
            }
            Map<String, Object> saida = new LinkedHashMap<>();
            saida.put("escrita", escrita);
            saida.put("resultado", ultimo);
            saida.put("resultados", resultados);
            return saida;
        });
    }

    private Map<String, Object> grade(ResultSet rs) throws Exception {
        ResultSetMetaData md = rs.getMetaData();
        int n = md.getColumnCount();
        List<String> colunas = new ArrayList<>(n);
        for (int i = 1; i <= n; i++) {
            colunas.add(md.getColumnLabel(i));
        }
        List<List<Object>> linhas = new ArrayList<>();
        while (rs.next()) {
            List<Object> linha = new ArrayList<>(n);
            for (int i = 1; i <= n; i++) {
                Object v = rs.getObject(i);
                if (v instanceof byte[] b) {
                    v = "0x" + HexFormat.of().formatHex(Arrays.copyOf(b, Math.min(b.length, 64)))
                            + (b.length > 64 ? "…" : "");
                }
                linha.add(v);
            }
            linhas.add(linha);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("tipo", "consulta");
        m.put("colunas", colunas);
        m.put("linhas", linhas);
        m.put("total", linhas.size());
        return m;
    }

    /** Remove comentários de linha e de bloco antes de classificar. */
    static String semComentario(String sql) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
                int fim = sql.indexOf('\n', i);
                i = fim < 0 ? sql.length() : fim;
                continue;
            }
            if (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*') {
                int fim = sql.indexOf("*/", i);
                i = fim < 0 ? sql.length() : fim + 1;
                continue;
            }
            sb.append(c);
        }
        return sb.toString().trim();
    }

    /** Divide em instruções por ';' respeitando aspas e comentários. */
    static List<String> dividir(String sql) {
        List<String> partes = new ArrayList<>();
        StringBuilder atual = new StringBuilder();
        char aspas = 0;
        for (int i = 0; i < sql.length(); i++) {
            char c = sql.charAt(i);
            if (aspas != 0) {
                atual.append(c);
                if (c == aspas) {
                    aspas = 0;
                }
                continue;
            }
            if (c == '\'' || c == '"') {
                aspas = c;
                atual.append(c);
                continue;
            }
            if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-') {
                int fim = sql.indexOf('\n', i);
                i = fim < 0 ? sql.length() : fim;
                continue;
            }
            if (c == ';') {
                String s = atual.toString().trim();
                if (!s.isEmpty()) {
                    partes.add(s);
                }
                atual.setLength(0);
                continue;
            }
            atual.append(c);
        }
        String s = atual.toString().trim();
        if (!s.isEmpty()) {
            partes.add(s);
        }
        return partes;
    }

    static boolean ehEscrita(String sql) {
        String comando = primeiraPalavra(semComentario(sql)).toLowerCase(Locale.ROOT);
        return !LEITURA.contains(comando);
    }

    static String primeiraPalavra(String sql) {
        String s = sql.strip();
        int i = 0;
        while (i < s.length() && !Character.isWhitespace(s.charAt(i)) && s.charAt(i) != '(') {
            i++;
        }
        return s.substring(0, i);
    }
}