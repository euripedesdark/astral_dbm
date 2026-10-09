package com.astral.dbm.config;

import com.astral.dbm.common.ApiResponse;
import com.astral.dbm.seguranca.AuthServiceClient;
import com.astral.dbm.seguranca.TokenAuthFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.io.IOException;
import java.util.List;

/**
 * Segurança da BASE.
 *
 * A identidade é o contrato do Auth Service ({@code {identityId, username,
 * provider, groups}}, §0.25): o DBM NÃO constrói login próprio, apenas valida
 * o Bearer consultando o Auth Service. O token chega desligado
 * ({@code dbm.auth.enabled=false}) para a base seguir aberta em rede local
 * enquanto o contrato é plugado na UI; ligado, a API exige o Bearer.
 */
@Configuration
public class SecurityConfig {

    /** Caminhos públicos mesmo com autenticação ligada (estáticos + health/docs). */
    private static final String[] PUBLICOS = {
            "/", "/index.html", "/assets/**", "/dist/**", "/favicon.ico", "/vite.svg",
            "/actuator/health",
            "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html",
            "/error"
    };

    private final DbmProperties props;
    private final AuthServiceClient authService;
    private final ObjectMapper mapper;

    public SecurityConfig(DbmProperties props, AuthServiceClient authService, ObjectMapper mapper) {
        this.props = props;
        this.authService = authService;
        this.mapper = mapper;
    }

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsSource()));

        if (props.getAuth().isEnabled()) {
            http.addFilterBefore(new TokenAuthFilter(props, authService, mapper),
                            UsernamePasswordAuthenticationFilter.class)
                    .authorizeHttpRequests(auth -> auth
                            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                            .requestMatchers(PUBLICOS).permitAll()
                            .anyRequest().authenticated())
                    .exceptionHandling(ex -> ex.authenticationEntryPoint(this::naoAutenticado));
        } else {
            http.authorizeHttpRequests(auth -> auth.anyRequest().permitAll());
        }
        return http.build();
    }

    private void naoAutenticado(HttpServletRequest req, HttpServletResponse res, AuthenticationException e)
            throws IOException {
        res.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        res.setContentType("application/json");
        res.setCharacterEncoding("UTF-8");
        mapper.writeValue(res.getWriter(),
                ApiResponse.error("NAO_AUTENTICADO", "Envie Authorization: Bearer <token> válido do Auth Service"));
    }

    private CorsConfigurationSource corsSource() {
        CorsConfiguration c = new CorsConfiguration();
        // Vite dev server.
        c.setAllowedOrigins(List.of("http://localhost:5173", "http://127.0.0.1:5173"));
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        c.setAllowedHeaders(List.of("*"));
        c.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", c);
        return source;
    }
}
