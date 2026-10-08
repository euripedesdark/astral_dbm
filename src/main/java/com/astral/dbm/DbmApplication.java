package com.astral.dbm;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * Astral Database Manager.
 *
 * Produto separado do Astral Platform (spec §0.14/§0.16). Este processo tem
 * banco PRÓPRIO (astral_dbm) e abre conexões JDBC para os bancos-ALVO que o
 * usuário cadastra.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class DbmApplication {
    public static void main(String[] args) {
        SpringApplication.run(DbmApplication.class, args);
    }
}