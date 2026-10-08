package com.astral.dbm.conexao;

import com.astral.dbm.common.ApiResponse;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Conexões (menu "Conexões" da spec §1).
 */
@RestController
@RequestMapping("/api")
public class ConexaoController {

    private final ConexaoService service;

    public ConexaoController(ConexaoService service) {
        this.service = service;
    }

    @GetMapping("/conexoes")
    public ApiResponse<List<Map<String, Object>>> listar() {
        return ApiResponse.ok(service.listar().stream().map(ConexaoController::dto).toList());
    }

    @PostMapping("/conexoes")
    public ApiResponse<Void> criar(@RequestBody ConexaoDtos.ConexaoRequest req) {
        service.criar(req);
        return ApiResponse.ok(null);
    }

    @PutMapping("/conexoes/{id}")
    public ApiResponse<Void> atualizar(@PathVariable UUID id, @RequestBody ConexaoDtos.ConexaoRequest req) {
        service.atualizar(id, req);
        return ApiResponse.ok(null);
    }

    @DeleteMapping("/conexoes/{id}")
    public ApiResponse<Void> remover(@PathVariable UUID id) {
        service.remover(id);
        return ApiResponse.ok(null);
    }

    @PostMapping("/conexoes/{id}/testar")
    public ApiResponse<Map<String, Object>> testar(@PathVariable UUID id) {
        return ApiResponse.ok(Map.of("versao", service.testar(id)));
    }

    @PostMapping("/conexoes/testar")
    public ApiResponse<Map<String, Object>> testarSemSalvar(@RequestBody ConexaoDtos.TesteRequest req) {
        return ApiResponse.ok(Map.of("versao", service.testar(req)));
    }

    @GetMapping("/drivers")
    public ApiResponse<List<ConexaoRepository.DriverRow>> drivers() {
        return ApiResponse.ok(service.drivers());
    }

    @GetMapping("/grupos")
    public ApiResponse<List<Map<String, Object>>> grupos() {
        return ApiResponse.ok(service.grupos());
    }

    private static Map<String, Object> dto(ConexaoRepository.ConexaoRow c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.uuid());
        m.put("nome", c.nome());
        m.put("driverId", c.driverId());
        m.put("driver", c.driverNome());
        m.put("url", c.url());
        m.put("usuario", c.usuarioBd());
        m.put("esquemaPadrao", c.esquemaPadrao());
        m.put("grupo", c.grupoNome());
        m.put("global", c.global());
        m.put("somenteLeitura", c.somenteLeitura());
        m.put("timeoutMs", c.timeoutMs());
        return m;
    }
}