package com.astral.dbm.common;

/**
 * Erro de negócio do DBM, já com o código que a UI usa para decidir o que
 * mostrar (ex.: CONFIRMACAO_NECESSARIA vira o diálogo de confirmação).
 */
public class DbmException extends RuntimeException {

    private final String codigo;

    public DbmException(String codigo, String mensagem) {
        super(mensagem);
        this.codigo = codigo;
    }

    public String getCodigo() {
        return codigo;
    }

    public static DbmException confirmacao(String mensagem) {
        return new DbmException("CONFIRMACAO_NECESSARIA", mensagem);
    }

    public static DbmException invalido(String mensagem) {
        return new DbmException("SQL_INVALIDO", mensagem);
    }

    public static DbmException naoEncontrado(String mensagem) {
        return new DbmException("NAO_ENCONTRADO", mensagem);
    }
}