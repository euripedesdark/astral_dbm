package com.astral.dbm.query;

import com.astral.dbm.auditoria.AuditoriaService;
import com.astral.dbm.common.ApiResponse;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

/**
 * Console/editor SQL (spec §8).
 */
@RestController
@RequestMapping("/api/conexoes/{id}")
public class QueryController {

    private final QueryService query;
    private final AuditoriaService auditoria;

    public QueryController(QueryService query, AuditoriaService auditoria) {
        this.query = query;
        this.auditoria = auditoria;
    }

    @PostMapping("/executar")
    public ApiResponse<Map<String, Object>> executar(@PathVariable UUID id,
                                                     @RequestBody ExecutarRequest req) {
        long inicio = System.currentTimeMillis();
        long conexaoId = auditoria.conexaoInterna(id);
        try {
            Map<String, Object> r = query.executar(id, req.sql(), req.confirmar());
            long ms = System.currentTimeMillis() - inicio;
            Object resultado = r.get("resultado");
            Long afetadas = null;
            if (resultado instanceof Map<?, ?> m && m.get("linhasAfetadas") instanceof Long l) {
                afetadas = l;
            }
            auditoria.registrar(conexaoId, req.sql(), AuditoriaService.tipo(req.sql()),
                    "ok", afetadas, ms, null);
            return ApiResponse.ok(r);
        } catch (RuntimeException e) {
            auditoria.registrar(conexaoId, req.sql(), AuditoriaService.tipo(req.sql()),
                    "falha", null, System.currentTimeMillis() - inicio, e.getMessage());
            throw e;
        }
    }

    public record ExecutarRequest(String sql, boolean confirmar) {
    }
}