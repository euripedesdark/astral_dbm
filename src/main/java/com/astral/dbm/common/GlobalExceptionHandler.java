package com.astral.dbm.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(DbmException.class)
    public ResponseEntity<ApiResponse<Void>> tratar(DbmException e) {
        HttpStatus status = switch (e.getCodigo()) {
            case "CONFIRMACAO_NECESSARIA" -> HttpStatus.CONFLICT;
            case "NAO_ENCONTRADO" -> HttpStatus.NOT_FOUND;
            default -> HttpStatus.BAD_REQUEST;
        };
        return ResponseEntity.status(status).body(ApiResponse.error(e.getCodigo(), e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> tratar(Exception e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error("ERRO_SQL", e.getMessage()));
    }
}