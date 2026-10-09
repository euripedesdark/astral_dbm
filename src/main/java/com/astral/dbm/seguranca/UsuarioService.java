package com.astral.dbm.seguranca;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Perfil local do usuário autenticado (spec §0.19, §14.1).
 *
 * O DBM nunca concede papel nem autentica: esta classe só apaga/atualiza a
 * linha de perfil em {@code dbm_usuario}, nascida do token válido.
 */
@Service
public class UsuarioService {

    private final UsuarioRepository repo;

    public UsuarioService(UsuarioRepository repo) {
        this.repo = repo;
    }

    public Map<String, Object> registrar(Identidade id) {
        String username = id.username();
        String source = (id.provider() == null || id.provider().isBlank()) ? "DESCONHECIDO" : id.provider();

        Long usuarioDbmId = repo.garantir(username, source);
        UsuarioRepository.UsuarioRow row = repo.porUsername(username);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("autenticado", true);
        m.put("identityId", id.identityId());
        m.put("username", username);
        m.put("provider", source);
        m.put("groups", id.groupsOuVazio());
        m.put("usuarioDbmId", usuarioDbmId);
        m.put("displayName", row == null ? null : row.displayName());
        m.put("ultimoAcessoEm", row == null || row.ultimoAcessoEm() == null
                ? null : row.ultimoAcessoEm().toInstant().toString());
        return m;
    }
}
