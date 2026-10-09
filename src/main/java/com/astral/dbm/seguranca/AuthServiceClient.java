package com.astral.dbm.seguranca;

import com.astral.dbm.config.DbmProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Consome o contrato do Auth Service (§0.25) por introspecção do token.
 *
 * O DBM NÃO decodifica o JWT por conta própria e NÃO conhece o segredo HS256:
 * ele pergunta ao Auth Service quem é o portador ({@code GET /identity/me}).
 * Assim o DBM nunca guarda/valida credencial e a rotação do segredo não o afeta.
 *
 * Resultados:
 * <ul>
 *   <li>{@code 200} → identidade (com cache curto por token);</li>
 *   <li>{@code 401/403} → {@code null} (token inválido, não é falha de infra);</li>
 *   <li>rede/5xx → {@link AuthIndisponivelException} (503 na ponta).</li>
 * </ul>
 */
@Component
public class AuthServiceClient {

    private final DbmProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final Map<String, EntradaCache> cache = new ConcurrentHashMap<>();

    private record EntradaCache(Identidade identidade, Instant expira) {
    }

    public AuthServiceClient(DbmProperties props, ObjectMapper mapper) {
        this.props = props;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(props.getAuth().getTimeoutMs()))
                .build();
    }

    /** Identidade do portador, {@code null} se o token for inválido. */
    public Identidade resolver(String token) {
        Instant agora = Instant.now();
        EntradaCache emCache = cache.get(token);
        if (emCache != null && emCache.expira().isAfter(agora)) {
            return emCache.identidade();
        }

        DbmProperties.Auth a = props.getAuth();
        HttpRequest req;
        try {
            req = HttpRequest.newBuilder(URI.create(a.getUrl() + a.getMePath()))
                    .timeout(Duration.ofMillis(a.getTimeoutMs()))
                    .header("Authorization", "Bearer " + token)
                    .GET()
                    .build();
        } catch (IllegalArgumentException e) {
            throw new AuthIndisponivelException("URL do Auth Service inválida: " + e.getMessage());
        }

        HttpResponse<String> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AuthIndisponivelException("Consulta ao Auth Service interrompida");
        } catch (Exception e) {
            throw new AuthIndisponivelException("Auth Service indisponível: " + e.getMessage());
        }

        int sc = resp.statusCode();
        if (sc == 200) {
            Identidade id = lerContrato(resp.body());
            long segundos = Math.max(0, a.getCacheSeconds());
            cache.put(token, new EntradaCache(id, agora.plusSeconds(segundos)));
            return id;
        }
        if (sc == 401 || sc == 403) {
            cache.remove(token);
            return null;
        }
        throw new AuthIndisponivelException("Auth Service respondeu " + sc);
    }

    private Identidade lerContrato(String json) {
        try {
            JsonNode n = mapper.readTree(json);
            List<String> grupos = new ArrayList<>();
            JsonNode groups = n.get("groups");
            if (groups != null && groups.isArray()) {
                groups.forEach(g -> grupos.add(g.asText()));
            }
            return new Identidade(txt(n, "identityId"), txt(n, "username"), txt(n, "provider"), List.copyOf(grupos));
        } catch (Exception e) {
            throw new AuthIndisponivelException("Contrato de identidade ilegível: " + e.getMessage());
        }
    }

    private static String txt(JsonNode n, String campo) {
        JsonNode v = n.get(campo);
        return v == null || v.isNull() ? null : v.asText();
    }
}
