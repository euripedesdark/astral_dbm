package com.astral.dbm.seguranca;

import com.astral.dbm.common.ApiResponse;
import com.astral.dbm.config.DbmProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * Transforma {@code Authorization: Bearer <token>} na identidade do DBM,
 * consultando o Auth Service (§0.25). Não há login, senha nem sessão própria:
 * o token é a sessão, e ele é validado pelo Auth Service.
 *
 * <ul>
 *   <li>sem {@code Authorization} → segue anônimo (o authorizeHttpRequests decide);</li>
 *   <li>token inválido/expirado → 401;</li>
 *   <li>Auth Service fora → 503 (fonte indisponível ≠ usuário negado, §0.20).</li>
 * </ul>
 */
public class TokenAuthFilter extends OncePerRequestFilter {

    private final DbmProperties props;
    private final AuthServiceClient client;
    private final ObjectMapper mapper;

    public TokenAuthFilter(DbmProperties props, AuthServiceClient client, ObjectMapper mapper) {
        this.props = props;
        this.client = client;
        this.mapper = mapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!props.getAuth().isEnabled()) {
            chain.doFilter(req, res);
            return;
        }

        String header = req.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            chain.doFilter(req, res);
            return;
        }

        String token = header.substring(7).trim();
        if (token.isEmpty()) {
            responder(res, HttpServletResponse.SC_UNAUTHORIZED, "TOKEN_VAZIO", "Cabeçalho Authorization sem token");
            return;
        }

        try {
            Identidade id = client.resolver(token);
            if (id == null) {
                responder(res, HttpServletResponse.SC_UNAUTHORIZED, "NAO_AUTENTICADO",
                        "Token inválido ou expirado no Auth Service");
                return;
            }
            List<GrantedAuthority> autoridades = id.groupsOuVazio().stream()
                    .map(g -> (GrantedAuthority) new SimpleGrantedAuthority(g))
                    .toList();
            var auth = new UsernamePasswordAuthenticationToken(id, token, autoridades);
            SecurityContextHolder.getContext().setAuthentication(auth);
            chain.doFilter(req, res);
        } catch (AuthIndisponivelException e) {
            responder(res, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "AUTH_INDISPONIVEL", e.getMessage());
        }
    }

    private void responder(HttpServletResponse res, int status, String codigo, String mensagem) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        res.setCharacterEncoding("UTF-8");
        mapper.writeValue(res.getWriter(), ApiResponse.error(codigo, mensagem));
    }
}
