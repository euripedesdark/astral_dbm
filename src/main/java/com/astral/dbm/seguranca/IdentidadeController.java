package com.astral.dbm.seguranca;

import com.astral.dbm.common.ApiResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Identidade do usuário corrente (spec §0.25).
 *
 * O DBM não tem tela de login: quem envia o Bearer do Auth Service recebe aqui
 * o próprio perfil, e a linha de {@code dbm_usuario} nasce neste primeiro acesso.
 * Sem autenticação (§0.22.3) o endpoint continua respondível e diz que não há
 * identidade — a ausência é um fato, não um 500.
 */
@RestController
@RequestMapping("/api")
public class IdentidadeController {

    private final UsuarioService usuarioService;

    public IdentidadeController(UsuarioService usuarioService) {
        this.usuarioService = usuarioService;
    }

    @GetMapping("/usuarios/eu")
    public ApiResponse<Map<String, Object>> eu(Authentication auth) {
        Object principal = auth == null ? null : auth.getPrincipal();
        if (principal instanceof Identidade id) {
            return ApiResponse.ok(usuarioService.registrar(id));
        }
        Map<String, Object> anonimo = new LinkedHashMap<>();
        anonimo.put("autenticado", false);
        return ApiResponse.ok(anonimo);
    }
}
