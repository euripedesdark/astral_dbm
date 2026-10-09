package com.astral.dbm.common;

/**
 * Aspas seguras de identificadores SQL (nome de banco/schema/tabela/coluna).
 *
 * Nomes não podem ser parametrizados em JDBC, então a única defesa honesta é
 * citar sempre com aspas duplas e dobrar aspas internas.
 */
public final class Ident {

    private Ident() {
    }

    public static String quote(String ident) {
        if (ident == null || ident.isBlank()) {
            throw DbmException.invalido("Identificador vazio");
        }
        return "\"" + ident.replace("\"", "\"\"") + "\"";
    }
}
