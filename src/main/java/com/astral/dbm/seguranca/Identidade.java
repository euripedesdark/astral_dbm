package com.astral.dbm.seguranca;

import java.util.List;

/**
 * O ÚNICO contrato de identidade que o DBM consome (spec §0.25):
 *
 * <pre>{ "identityId", "username", "provider", "groups" }</pre>
 *
 * É o que o Auth Service devolve em {@code GET /api/v1/identity/me}. O DBM
 * nunca valida senha, nunca constrói login: ele apenas lê esta identidade.
 *
 * {@code provider} é TEXT com vocabulário documentado (AD, POSTGRES, LINUX,
 * ...), não enum fechado — a fonte de identidade está em evolução (§0.22.3).
 */
public record Identidade(String identityId, String username, String provider, List<String> groups) {

    public List<String> groupsOuVazio() {
        return groups == null ? List.of() : groups;
    }
}
