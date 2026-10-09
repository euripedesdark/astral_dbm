package com.astral.dbm.explorer;

import com.astral.dbm.common.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Explorer / estrutura — spec §2.1 e §7.
 */
@RestController
@RequestMapping("/api/conexoes/{id}")
public class CatalogoController {

    private final CatalogoService catalogo;
    private final DdlService ddl;

    public CatalogoController(CatalogoService catalogo, DdlService ddl) {
        this.catalogo = catalogo;
        this.ddl = ddl;
    }

    @GetMapping("/schemas")
    public ApiResponse<List<String>> schemas(@PathVariable UUID id) {
        return ApiResponse.ok(catalogo.schemas(id));
    }

    @GetMapping("/catalogo")
    public ApiResponse<Map<String, Object>> catalogo(@PathVariable UUID id,
                                                     @RequestParam(required = false) String schema) {
        return ApiResponse.ok(catalogo.catalogo(id, schema));
    }

    @GetMapping("/estrutura")
    public ApiResponse<Map<String, Object>> estrutura(@PathVariable UUID id,
                                                      @RequestParam String schema,
                                                      @RequestParam String tabela) {
        return ApiResponse.ok(Map.of(
                "colunas", catalogo.colunas(id, schema, tabela),
                "primarias", catalogo.chavesPrimarias(id, schema, tabela),
                "indices", catalogo.indices(id, schema, tabela),
                "estrangeiras", catalogo.estrangeiras(id, schema, tabela)));
    }

    /** DDL do objeto a partir do estado existente (spec §10.3). */
    @GetMapping("/ddl")
    public ApiResponse<Map<String, Object>> ddl(@PathVariable UUID id,
                                                @RequestParam String schema,
                                                @RequestParam String nome,
                                                @RequestParam(defaultValue = "tabela") String tipo,
                                                @RequestParam(required = false) String tabela) {
        return ApiResponse.ok(ddl.gerar(id, schema, nome, tipo, tabela));
    }

    @GetMapping("/dados")
    public ApiResponse<Map<String, Object>> dados(@PathVariable UUID id,
                                                  @RequestParam String schema,
                                                  @RequestParam String tabela,
                                                  @RequestParam(defaultValue = "0") int pagina,
                                                  @RequestParam(defaultValue = "100") int tamanho,
                                                  @RequestParam(required = false) String busca) {
        return ApiResponse.ok(catalogo.dados(id, schema, tabela, pagina, tamanho, busca));
    }
}