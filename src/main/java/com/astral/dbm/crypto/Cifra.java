package com.astral.dbm.crypto;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Cifra da senha do banco-ALVO (spec §0.19.2).
 *
 * A senha nunca fica em claro: é gravada em {@code senha_cifrada BYTEA} com
 * AES/GCM. A chave vem de {@code dbm.cifra.chave} (Base64 de 32 bytes). Sem
 * chave configurada, gera uma efêmera e avisa — nesse modo a senha não
 * sobrevive a um restart.
 */
@Component
public class Cifra {

    private static final Logger log = LoggerFactory.getLogger(Cifra.class);
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    @Value("${dbm.cifra.chave:}")
    private String chaveBase64;

    private byte[] chave;

    @PostConstruct
    void inicializar() {
        if (chaveBase64 != null && !chaveBase64.isBlank()) {
            chave = Base64.getDecoder().decode(chaveBase64.trim());
            if (chave.length != 16 && chave.length != 24 && chave.length != 32) {
                throw new IllegalStateException("dbm.cifra.chave precisa ter 16, 24 ou 32 bytes (Base64)");
            }
        } else {
            chave = new byte[32];
            new SecureRandom().nextBytes(chave);
            log.warn("dbm.cifra.chave não definida: usando chave efêmera. "
                    + "A senha das conexões NÃO sobreviverá a um restart.");
        }
    }

    public byte[] cifrar(String texto) {
        if (texto == null) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            new SecureRandom().nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(chave, "AES"), new GCMParameterSpec(TAG_BITS, iv));
            byte[] enc = cipher.doFinal(texto.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + enc.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(enc, 0, out, iv.length, enc.length);
            return out;
        } catch (Exception e) {
            throw new IllegalStateException("Falha ao cifrar senha", e);
        }
    }

    public String decifrar(byte[] dados) {
        if (dados == null || dados.length <= IV_BYTES) {
            return null;
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            System.arraycopy(dados, 0, iv, 0, IV_BYTES);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(chave, "AES"), new GCMParameterSpec(TAG_BITS, iv));
            byte[] dec = cipher.doFinal(dados, IV_BYTES, dados.length - IV_BYTES);
            return new String(dec, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new IllegalStateException("Falha ao decifrar senha (a chave mudou?)", e);
        }
    }
}