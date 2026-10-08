package com.astral.dbm.common;

/**
 * Envelope de resposta da API — mesmo formato do Brasil SaaS ERP.
 */
public record ApiResponse<T>(boolean success, T data, Error erro) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, null);
    }

    public static <T> ApiResponse<T> error(String codigo, String mensagem) {
        return new ApiResponse<>(false, null, new Error(codigo, mensagem));
    }

    public record Error(String codigo, String mensagem) {
    }
}