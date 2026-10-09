package com.astral.dbm.seguranca;

/**
 * A FONTE de identidade não respondeu — o que é diferente de "token inválido".
 *
 * Regra §0.20 (a mesma em toda a base): ausência de resposta não é ausência de
 * dado. Quando o Auth Service está fora, o DBM responde 503 (não sei) e nunca
 * 401 (não é você), porque um 401 num host fora induz retry de credencial certo.
 */
public class AuthIndisponivelException extends RuntimeException {

    public AuthIndisponivelException(String mensagem) {
        super(mensagem);
    }
}
