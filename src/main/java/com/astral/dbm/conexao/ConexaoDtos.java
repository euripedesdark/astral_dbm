package com.astral.dbm.conexao;

/**
 * DTOs da tela de conexões. O campo {@code senha} só entra; nunca sai.
 */
public final class ConexaoDtos {

    private ConexaoDtos() {
    }

    public record ConexaoRequest(
            String nome,
            Long driverId,
            String url,
            String usuario,
            String senha,
            String esquemaPadrao,
            Long grupoId,
            boolean global,
            boolean somenteLeitura,
            int timeoutMs) {

        public int timeoutEfetivo() {
            return timeoutMs <= 0 ? 30_000 : timeoutMs;
        }
    }

    public record TesteRequest(
            Long driverId,
            String url,
            String usuario,
            String senha) {
    }
}