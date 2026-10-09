package com.astral.dbm.explorer;

import com.astral.dbm.auditoria.AuditoriaService;
import com.astral.dbm.common.ApiResponse;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Bancos e schemas do alvo (menus "Bancos"/"Schemas", spec §4).
 */
@RestController
@RequestMapping("/api/conexoes/{id}")
public class BancosController {

    private final BancosService bancos;
    private final AuditoriaService auditoria;

    public BancosController(BancosService bancos, AuditoriaService auditoria) {
        this.bancos = bancos;
        this.auditoria = auditoria;
    }

    @GetMapping("/bancos")
    public ApiResponse<List<Map<String, Object>>> listar(@PathVariable UUID id) {
        return ApiResponse.ok(bancos.listar(id));
    }

    @PostMapping("/bancos/sql")
    public ApiResponse<Map<String, Object>> prever(@PathVariable UUID id, @RequestBody BancoRequest r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sql", bancos.sqlCriarBanco(r.nome(), r.dono(), r.encoding(), r.template()));
        return ApiResponse.ok(m);
    }

    @PostMapping("/bancos")
    public ApiResponse<Map<String, Object>> criar(@PathVariable UUID id, @RequestBody BancoRequest r) {
        return auditar(id, () -> bancos.criarBanco(
                id, r.nome(), r.dono(), r.encoding(), r.template(), r.confirmar()));
    }

    @DeleteMapping("/bancos/{nome}")
    public ApiResponse<Map<String, Object>> dropar(@PathVariable UUID id,
                                                   @PathVariable String nome,
                                                   @RequestParam String confirmacao,
                                                   @RequestParam(defaultValue = "false") boolean forcar) {
        return auditar(id, () -> bancos.droparBanco(id, nome, confirmacao, forcar));
    }

    @PostMapping("/schemas")
    public ApiResponse<Map<String, Object>> criarSchema(@PathVariable UUID id,
                                                        @RequestBody SchemaRequest r) {
        return auditar(id, () -> bancos.criarSchema(id, r.nome(), r.confirmar()));
    }

    @DeleteMapping("/schemas/{nome}")
    public ApiResponse<Map<String, Object>> droparSchema(@PathVariable UUID id,
                                                         @PathVariable String nome,
                                                         @RequestParam String confirmacao,
                                                         @RequestParam(defaultValue = "false") boolean cascade) {
        return auditar(id, () -> bancos.droparSchema(id, nome, confirmacao, cascade));
    }

    /** Toda DDL administrativa entra na trilha (spec §7.2/§7.3). */
    private ApiResponse<Map<String, Object>> auditar(UUID id, Supplier<Map<String, Object>> op) {
        long inicio = System.currentTimeMillis();
        long conexaoId = auditoria.conexaoInterna(id);
        try {
            Map<String, Object> r = op.get();
            String sql = String.valueOf(r.get("sql"));
            auditoria.registrar(conexaoId, sql, AuditoriaService.tipo(sql),
                    "ok", null, System.currentTimeMillis() - inicio, null);
            return ApiResponse.ok(r);
        } catch (RuntimeException e) {
            auditoria.registrar(conexaoId, "DDL recusada: " + e.getMessage(), "DDL", "falha", null,
                    System.currentTimeMillis() - inicio, e.getMessage());
            throw e;
        }
    }

    public record BancoRequest(String nome, String dono, String encoding, String template,
                               boolean confirmar) {
    }

    public record SchemaRequest(String nome, boolean confirmar) {
    }
}
