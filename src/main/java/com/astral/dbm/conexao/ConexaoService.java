package com.astral.dbm.conexao;

import com.astral.dbm.common.DbmException;
import com.astral.dbm.config.DbmProperties;
import com.astral.dbm.crypto.Cifra;
import com.astral.dbm.pool.PoolConexoes;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Conexões com bancos-ALVO (spec §6.9, §0.19.2).
 *
 * A senha do alvo é cifrada ao salvar e só é decifrada no instante de abrir o
 * pool. A API nunca devolve senha.
 */
@Service
public class ConexaoService {

    private final ConexaoRepository repo;
    private final Cifra cifra;
    private final PoolConexoes pools;
    private final DbmProperties props;

    public ConexaoService(ConexaoRepository repo, Cifra cifra, PoolConexoes pools, DbmProperties props) {
        this.repo = repo;
        this.cifra = cifra;
        this.pools = pools;
        this.props = props;
    }

    public List<ConexaoRepository.ConexaoRow> listar() {
        return repo.listar();
    }

    public List<ConexaoRepository.DriverRow> drivers() {
        return repo.listarDrivers();
    }

    public List<java.util.Map<String, Object>> grupos() {
        return repo.listarGrupos();
    }

    public ConexaoRepository.ConexaoRow exigir(java.util.UUID id) {
        ConexaoRepository.ConexaoRow c = repo.porUuid(id);
        if (c == null) {
            throw com.astral.dbm.common.DbmException.naoEncontrado("Conexão " + id + " não existe");
        }
        return c;
    }

    public void criar(ConexaoDtos.ConexaoRequest r) {
        Long criadoPor = repo.idDoUsuarioPadrao();
        byte[] senha = cifra.cifrar(r.senha());
        repo.inserir(r.nome(), r.driverId(), r.url(), r.usuario(), senha, r.esquemaPadrao(),
                r.grupoId(), r.global(), r.somenteLeitura(), r.timeoutEfetivo(), criadoPor);
    }

    public void atualizar(java.util.UUID id, ConexaoDtos.ConexaoRequest r) {
        exigir(id);
        byte[] senha = (r.senha() == null || r.senha().isBlank()) ? null : cifra.cifrar(r.senha());
        repo.atualizar(id, r.nome(), r.driverId(), r.url(), r.usuario(), senha, r.esquemaPadrao(),
                r.grupoId(), r.global(), r.somenteLeitura(), r.timeoutEfetivo());
        pools.invalidar(id);
    }

    public void remover(java.util.UUID id) {
        exigir(id);
        pools.invalidar(id);
        repo.remover(id);
    }

    public String testar(java.util.UUID id) {
        ConexaoRepository.ConexaoRow c = exigir(id);
        String senha = cifra.decifrar(repo.senhaCifrada(id));
        return pools.testar(c.driverJdbcClass(), c.url(), c.usuarioBd(), senha, c.timeoutMs());
    }

    public String testar(ConexaoDtos.TesteRequest r) {
        ConexaoRepository.DriverRow d = repo.driverPorId(r.driverId());
        if (d == null) {
            throw DbmException.naoEncontrado("Driver " + r.driverId() + " não existe");
        }
        return pools.testar(d.jdbcClass(), r.url(), r.usuario(), r.senha(), 30_000);
    }

    /** JdbcTemplate ligado ao banco-alvo (catálogo, browse e consultas). */
    public org.springframework.jdbc.core.JdbcTemplate jdbcDe(java.util.UUID id) {
        ConexaoRepository.ConexaoRow c = exigir(id);
        String senha = cifra.decifrar(repo.senhaCifrada(id));
        javax.sql.DataSource ds = pools.dataSource(id, c.driverJdbcClass(), c.url(),
                c.usuarioBd(), senha, c.timeoutMs());
        return new org.springframework.jdbc.core.JdbcTemplate(ds);
    }

    public boolean somenteLeitura(java.util.UUID id) {
        return exigir(id).somenteLeitura();
    }

    public int linhasMax() {
        return props.getLinhasMax();
    }
}