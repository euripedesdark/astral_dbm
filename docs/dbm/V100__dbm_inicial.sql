-- =====================================================================
-- V100__dbm_inicial.sql
-- Astral Database Manager -- banco interno `astral_dbm`
-- Especificacao: docs/ASTRAL-DATABASE-MANAGER.md
--   secoes 0.14 (banco por projeto), 0.16 (astral_dbm), 0.17 (regra do score),
--   0.18 (prefixo dbm_), 0.20 (fonte nao e ausencia), 0.22 (governanca),
--   6.3 (eixo de escopo), 7.2/7.3/7.8 (auditoria), 13.8 (papeis),
--   13.10 (escopo fechado da V100), 14 (modelo relacional)
--
-- ONDE ESTA migration NAO PODE RODAR
--   Medido: o unico Flyway do repositorio Astral e o do `fabric/firewall`,
--   e a datasource dele e jdbc:postgresql://127.0.0.1:5432/astral.
--   Se este arquivo for colocado em classpath:db/migration desse modulo, o
--   Flyway vai criar as tabelas do DBM DENTRO do banco `astral`, que e
--   justamente o que a diretriz de um banco por projeto proibe (0.14).
--   Ver 0.22.4. Este arquivo mora com a especificacao ate o local de
--   execucao ser decidido.
--
-- REGRAS QUE ESTE ARQUIVO CUMPRE, E QUE DAQUI PARA FRENTE SAO OBRIGATORIAS
--   1. Sem `CREATE SCHEMA`: o schema e `public` do `astral_dbm` (0.18, 14).
--   2. Sem `empresa_id` em tabela nenhuma (0.15, 0.18).
--   3. Prefixo `dbm_`, nunca `bc_` nem `astral_dbm_` (0.18).
--   4. FK com `ON DELETE RESTRICT`. Nunca CASCADE, nunca SET NULL em coluna
--      de trilha: cascade apaga a auditoria junto com o usuario, e SET NULL
--      transforma "quem fez" em "nao se sabe" (14).
--   5. Sem `senha_hash` em tabela de usuario. A senha do BANCO ALVO e
--      `senha_cifrada BYTEA` porque o JDBC precisa reescreve-la; senha de
--      LOGIN do DBM nao existe (0.19, 14.1).
--   6. `source` do usuario e TEXT, nao CHECK fechado: a autenticacao esta em
--      evolucao e a validacao por Linux entrou no modelo (0.22.3).
--   7. Toda tabela tem COMMENT ON TABLE. "Ninguem sabia que existia" e o
--      modo de falha que a 0.21 existe para impedir, e um comentario no
--      catalogo do banco e a forma mais barata de impedir que volte.
--   8. Sem extensao. pgcrypto saiu em 29/09: a V100 nao chama nenhuma funcao
--      dela (0 chamadas em SQL executavel) e as 12 `gen_random_uuid()` sao
--      nucleo do PostgreSQL desde a versao 13. `senha_cifrada` e BYTEA
--      cifrado pela aplicacao, nao pelo banco. Dependencia sem consumidor
--      declarado nao entra (0.24).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. IDENTIDADE -- primeiro, porque todo o resto tem FK para estas duas.
--    (13.10)
-- ---------------------------------------------------------------------

-- 14.1: perfil e preferencia. NAO e fonte de identidade, NAO autentica
-- ninguem, e nao tem hash. A linha nasce no primeiro acesso autenticado.
CREATE TABLE dbm_usuario (
    id             BIGSERIAL   PRIMARY KEY,
    uuid           UUID        NOT NULL DEFAULT gen_random_uuid(),
    username       TEXT        NOT NULL,
    -- 0.22.3: TEXT com vocabulario documentado (AD, POSTGRES, LINUX).
    -- Nao e CHECK de dois valores: um CHECK rejeitaria um login legitimo
    -- quando a MUSE adicionar a fonte seguinte.
    source         TEXT        NOT NULL,
    display_name   TEXT,
    preferencias   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ultimo_acesso_em TIMESTAMP,
    ativo          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMP   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMP
);

-- A chave e o mesmo username que o token carrega, nao e-mail e nao id interno.
CREATE UNIQUE INDEX ux_dbm_usuario_username ON dbm_usuario (lower(username));
COMMENT ON TABLE dbm_usuario IS
  'Perfil local e preferencia. Nao guarda senha, nao autentica, nao concede papel. '
  'A identidade vem do token do Astral (0.19). Tela: Meu perfil.';

-- 14.1: catalogo dos papeis que o DBM conhece. Nao concede nada: mapeia
-- autoridade -> permissao em dbm_permissao, e autoriza a UI a mostrar o nome.
CREATE TABLE dbm_papel (
    id          BIGSERIAL PRIMARY KEY,
    uuid        UUID      NOT NULL DEFAULT gen_random_uuid(),
    nome        TEXT      NOT NULL,
    descricao   TEXT,
    -- 'astral' = veio do token; 'configurado' = criado aqui.
    -- 'astral' impede que um papel exigido pela autenticacao seja apagado.
    origem      TEXT      NOT NULL DEFAULT 'configurado'
                CHECK (origem IN ('astral','configurado')),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_papel_nome ON dbm_papel (lower(nome));
COMMENT ON TABLE dbm_papel IS
  'Catalogo dos papeis conhecidos, semeado dos papeis do Astral (0.19.1). '
  'NAO concede papel: papel e fato do AD/Postgres/Linux. Autoridade fora deste '
  'catalogo nao concede nada. Tela: Papeis do DBM (leitura).';

-- 14.19: chave/valor. Quem consome cada chave esta declarado na 14.19 e a
-- tela dona e obligatoria (0.21.1 -- chave sem tela dona e o furo).
CREATE TABLE dbm_configuracao (
    id         BIGSERIAL PRIMARY KEY,
    chave      TEXT      NOT NULL,
    valor      TEXT,
    tipo       TEXT      NOT NULL DEFAULT 'texto'
               CHECK (tipo IN ('texto','inteiro','booleano','json')),
    descricao  TEXT,
    updated_por BIGINT   REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_configuracao_chave ON dbm_configuracao (chave);
COMMENT ON TABLE dbm_configuracao IS
  'Chave/valor do DBM. Tela dona por chave: linhas_max e timeouts em '
  'Conexoes > Editar conexao e na barra do editor; retener_auditoria_meses em '
  'Auditoria > Retencao; allow_risco em Inteligencia > Analisador de Query.';

-- ---------------------------------------------------------------------
-- 2. CONEXOES
-- ---------------------------------------------------------------------

-- 14.3: pastas por ambiente (producao, homologacao, desenvolvimento).
CREATE TABLE dbm_grupo_conexao (
    id         BIGSERIAL PRIMARY KEY,
    uuid       UUID      NOT NULL DEFAULT gen_random_uuid(),
    nome       TEXT      NOT NULL,
    cor        TEXT,
    ordem      INTEGER   NOT NULL DEFAULT 0,
    criado_por BIGINT    REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_grupo_conexao_nome ON dbm_grupo_conexao (lower(nome));
COMMENT ON TABLE dbm_grupo_conexao IS
  'Pastas por ambiente. Tela: Conexoes > Agrupar.';

-- 14.20: catalogo de drivers, JDBC-first. Entra na V100 e nao na V101 porque
-- sem ele nao existe primeira conexao: `dbm_conexao` aponta para esta
-- tabela, e apontar para um driver que ainda nao foi baixado e o que o
-- DBM tem de proibir.
CREATE TABLE dbm_driver (
    id                  BIGSERIAL PRIMARY KEY,
    uuid                UUID      NOT NULL DEFAULT gen_random_uuid(),
    nome                TEXT      NOT NULL,
    fabricante          TEXT      NOT NULL,
    versao              TEXT      NOT NULL,
    jdbc_class          TEXT      NOT NULL,
    jdbc_url_template   TEXT,
    -- NULL enquanto o canal de download do fabricante nao esta decidido
    -- (Oracle, DB2, SAP HANA e Informix tem canal proprio, fora do Maven
    -- Central). Coluna anulavel de proposito: travar a migration por causa
    -- de URL e o mesmo erro que travar arquitetura por CREATEDB.
    download_url        TEXT,
    checksum_sha256     TEXT,
    -- 'ausente' e a palavra que faz falta: o registro so entra em
    -- `verificado` quando o checksum bate. Sem estado para "ainda nao
    -- conferi", a ausencia vira 'parece bom' -- 0.20.3 de novo.
    assinatura          TEXT,
    ativo               BOOLEAN   NOT NULL DEFAULT TRUE,
    -- Nível 2, não certificado, e o campo diz: a máquina é o que sabe.
    suportado_nivel     TEXT      NOT NULL DEFAULT 'COMPATIVEL'
                        CHECK (suportado_nivel IN ('COMPATIVEL','SUPORTADO','CERTIFICADO')),
    cache_path          TEXT,
    tamanho_bytes       BIGINT,
    baixado_em          TIMESTAMP,
    verificado_em       TIMESTAMP,
    erro_verificacao    TEXT,
    -- A regra da 14.20 e sobre ESTADO, e nao sobre coluna NOT NULL: um driver
    -- registrado e ainda nao baixado legitimamente nao tem checksum, e
    -- obrigar a ter seria inventar dado. O que nao pode e `verificado`
    -- sem checksum -- e o que faria a UI dizer "verificado" sem ter conferido.
    CONSTRAINT ck_dbm_driver_verificado CHECK (verificado_em IS NULL OR checksum_sha256 IS NOT NULL),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP
);
-- UNIQUE por (fabricante, versao), e NAO por nome: duas versoes do mesmo
-- driver compartilham `nome`, e por isso `nome` nao pode ser a chave que
-- `dbm_conexao` referencia.
CREATE UNIQUE INDEX ux_dbm_driver ON dbm_driver (lower(fabricante), versao);
CREATE INDEX ix_dbm_driver_nome ON dbm_driver (lower(nome));
COMMENT ON TABLE dbm_driver IS
  'Catalogo de drivers JDBC, baixado e verificado no SERVIDOR (0.11), nunca no '
  'navegador. suportado_nivel e o que impede a UI de prometer certificado para o '
  'que so e compativel. Tela: Drivers.';

-- 14.2. Eixo de escopo: criado_por (usuario do DBM) e visivel_para (papel),
-- no lugar de empresa_id (6.3).
-- `usuario_bd` e nao `usuario`: e o login do BANCO ALVO, e deixar as duas
-- colunas com nome parecido em toda consulta e convite a bug.
-- `senha_cifrada` e BYTEA porque o JDBC precisa reescrever a senha no
-- connection string -- e por isso que ela existe, e por isso que ela nao e
-- a mesma coisa que senha de login (0.19.2).
CREATE TABLE dbm_conexao (
    id                     BIGSERIAL PRIMARY KEY,
    uuid                   UUID      NOT NULL DEFAULT gen_random_uuid(),
    grupo_id               BIGINT    REFERENCES dbm_grupo_conexao(id) ON DELETE RESTRICT,
    nome                   TEXT      NOT NULL,
    -- FK para o catalogo, e nao `driver TEXT`. Com 2 versoes do mesmo
    -- fabricante no catalogo, `nome` nao e unico, entao nao dava para
    -- referenciar por nome; e texto livre aceitaria "PostgreSQL 42.7.13"
    -- sem ninguem conferir -- a conexao era salva e so falhava ao abrir,
    -- que e a falha silenciosa que a 0.20.3 existe para impedir.
    driver_id              BIGINT    NOT NULL REFERENCES dbm_driver(id) ON DELETE RESTRICT,
    url                    TEXT      NOT NULL,
    usuario_bd             TEXT,
    senha_cifrada          BYTEA,
    esquema_padrao         TEXT,
    criado_por             BIGINT    NOT NULL REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    visivel_para           BIGINT    REFERENCES dbm_papel(id) ON DELETE RESTRICT,
    global                 BOOLEAN   NOT NULL DEFAULT FALSE,
    somente_leitura        BOOLEAN   NOT NULL DEFAULT FALSE,
    timeout_ms             INTEGER   NOT NULL DEFAULT 30000,
    linhas_max             INTEGER   NOT NULL DEFAULT 1000,
    max_linhas_exportacao  INTEGER,
    schemas_visiveis       TEXT[],
    objetos_visiveis       TEXT[],
    descricao              TEXT,
    ativo                  BOOLEAN   NOT NULL DEFAULT TRUE,
    ultimo_test_em         TIMESTAMP,
    ultimo_test_status     TEXT,
    ultimo_test_erro       TEXT,
    created_at             TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMP
);

-- UNIQUE global, sem empresa_id na chave: conexao e recurso compartilhado
-- do produto. Dois usuarios criando "producao" colide, e isso e o correto --
-- conexao duplicada e risco, nao conveniencia.
CREATE UNIQUE INDEX ux_dbm_conexao_nome ON dbm_conexao (lower(nome));
COMMENT ON TABLE dbm_conexao IS
  'Conexoes registradas. usuario_bd e o login do BANCO ALVO; criado_por e o '
  'usuario do DBM. driver_id aponta para dbm_driver, nao e texto livre (14.20). '
  'UNIQUE global de nome, sem empresa_id (6.3). Tela: Conexoes (8 itens).';

-- 14.4: a sessao de workbench e volátil e vive em Redis (dbm:wb:, 2.4/13.6).
-- Esta tabela e so o historico persistido, para auditar "quem ficou com
-- transacao aberta".
CREATE TABLE dbm_sessao_historico (
    id               BIGSERIAL PRIMARY KEY,
    uuid             UUID      NOT NULL DEFAULT gen_random_uuid(),
    usuario_id       BIGINT    NOT NULL REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    papel            TEXT,
    conexao_id       BIGINT    REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    aberto_em        TIMESTAMP NOT NULL DEFAULT NOW(),
    fechado_em       TIMESTAMP,
    transacao_aberta BOOLEAN   NOT NULL DEFAULT FALSE,
    sql_count        INTEGER   NOT NULL DEFAULT 0
);
CREATE INDEX ix_dbm_sessao_historico_usuario  ON dbm_sessao_historico (usuario_id, aberto_em DESC);
CREATE INDEX ix_dbm_sessao_historico_conexao  ON dbm_sessao_historico (conexao_id, aberto_em DESC);
COMMENT ON TABLE dbm_sessao_historico IS
  'Historico de sessao de workbench, para auditoria. O estado vivo fica em '
  'Redis, nao aqui (13.6). Tela: Seguranca do DBM > Sessoes do DBM.';

-- ---------------------------------------------------------------------
-- 3. TRABALHO DO USUARIO
-- ---------------------------------------------------------------------

-- 14.5. SEM coluna `favorite`: a versao anterior tinha `favorite BOOLEAN`
-- aqui E a tabela dbm_favorito. Dois lugares para o mesmo fato, e o que
-- marcava o favorito era o boolean -- favoritar e desfavoritar nao
-- deixavam rastro. Favorito e registro, nao flag (0.18).
CREATE TABLE dbm_historico_query (
    id           BIGSERIAL PRIMARY KEY,
    uuid         UUID      NOT NULL DEFAULT gen_random_uuid(),
    -- 14: trilha em RESTRICT. SET NULL aqui seria dois defeitos: apagaria o
    -- "quem executou" virando NULL, e com a coluna NOT NULL o DELETE falharia
    -- em runtime -- a FK aceitaria e a escrita quebraria depois.
    usuario_id   BIGINT    NOT NULL REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    conexao_id   BIGINT    NOT NULL REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    sql_text     TEXT      NOT NULL,
    sql_hash     TEXT,
    norm_sql     TEXT,
    titulo       TEXT,
    executado_em TIMESTAMP NOT NULL DEFAULT NOW(),
    duracao_ms   BIGINT,
    status       TEXT,
    linhas       BIGINT
);
CREATE INDEX ix_dbm_historico_query_usuario ON dbm_historico_query (usuario_id, executado_em DESC);
CREATE INDEX ix_dbm_historico_query_conexao ON dbm_historico_query (conexao_id, executado_em DESC);
COMMENT ON TABLE dbm_historico_query IS
  'Historico de SQL executado. SEM favorite BOOLEAN: favorito vive em '
  'dbm_favorito (14.6). Tela: painel Historico do editor SQL (3.1).';

-- 14.6. O antigo dbm_favorito_compartilhado morreu: existia so para marcar
-- "compartilhado com a empresa", e sem empresa o escopo e um atributo do
-- proprio favorito. Duas tabelas para um atributo e normalizacao desfeita.
CREATE TABLE dbm_favorito (
    id          BIGSERIAL PRIMARY KEY,
    uuid        UUID      NOT NULL DEFAULT gen_random_uuid(),
    usuario_id  BIGINT    NOT NULL REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    nome        TEXT      NOT NULL,
    sql_text    TEXT      NOT NULL,
    conexao_id  BIGINT    REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    escopo      TEXT      NOT NULL DEFAULT 'pessoal'
                CHECK (escopo IN ('pessoal','compartilhado')),
    descricao   TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_favorito ON dbm_favorito (usuario_id, escopo, lower(nome));
COMMENT ON TABLE dbm_favorito IS
  'Favoritos. escopo e atributo do favorito, nao tabela separada. '
  'Tela: painel Favoritos do editor SQL (3.1).';

-- 14.7
CREATE TABLE dbm_snippet (
    id          BIGSERIAL PRIMARY KEY,
    uuid        UUID      NOT NULL DEFAULT gen_random_uuid(),
    usuario_id  BIGINT    NOT NULL REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    nome        TEXT      NOT NULL,
    sql_text    TEXT      NOT NULL,
    descricao   TEXT,
    linguagem   TEXT,
    escopo      TEXT      NOT NULL DEFAULT 'pessoal'
                CHECK (escopo IN ('pessoal','compartilhado')),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_snippet ON dbm_snippet (usuario_id, escopo, lower(nome));
COMMENT ON TABLE dbm_snippet IS
  'Snippets de SQL. Tela: painel Snippets do editor SQL (3.1).';

-- ---------------------------------------------------------------------
-- 4. RBAC DO DBM -- 14.18, 13.8
--    O DBM nao concede papel: concede permissao a um PAPEL, e o papel vem
--    do token. Conceder papel e operacao no AD/Postgres/Linux (0.19.2).
-- ---------------------------------------------------------------------

CREATE TABLE dbm_permissao (
    id         BIGSERIAL PRIMARY KEY,
    papel_id   BIGINT NOT NULL REFERENCES dbm_papel(id) ON DELETE RESTRICT,
    permissao  TEXT   NOT NULL,
    -- NULL = global. Por isso o UNIQUE usa COALESCE: UNIQUE com NULL nao
    -- deduplica, e dois INSERT da mesma permissao global passariam.
    conexao_id BIGINT REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_permissao ON dbm_permissao (papel_id, permissao, COALESCE(conexao_id, 0));
CREATE INDEX ix_dbm_permissao_papel ON dbm_permissao (papel_id);
COMMENT ON TABLE dbm_permissao IS
  'Mapeia papel -> permissao dbm.*. Avaliada por @PreAuthorize no metodo do '
  'service, nao so no controller, para que um service chamado por job herde a '
  'mesma regra (13.8). Tela: Seguranca do DBM > Matriz de permissoes.';

-- 14.18: recorte de quais schemas/objetos um papel enxerga numa conexao.
CREATE TABLE dbm_permissao_escopo (
    id           BIGSERIAL PRIMARY KEY,
    conexao_id   BIGINT NOT NULL REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    papel_id     BIGINT NOT NULL REFERENCES dbm_papel(id) ON DELETE RESTRICT,
    schema_nome  TEXT,
    tipo_objeto  TEXT,
    nome_objeto  TEXT,
    pode_exportar BOOLEAN NOT NULL DEFAULT FALSE,
    teto_linhas  INTEGER,
    created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_permissao_escopo
  ON dbm_permissao_escopo (conexao_id, papel_id,
      COALESCE(schema_nome,''), COALESCE(tipo_objeto,''), COALESCE(nome_objeto,''));
-- 14.18, o terceiro do trio de RBAC. Sem esta tabela o papel "Somente
-- Leitura" nao tem como liberar NENHUMA funcao, e "nao consegue executar
-- funcao" e o estado default seguro -- mas e um furo silencioso, porque a
-- tela mostra o cadastro de funcoes vazio sem dizer que ele e a regra e nao
-- um esquecimento. Aqui a lista vazia e um fato do schema.
--
-- Sem conexao_id, como no 14.18: a allowlist e do PAPEL, nao da conexao.
CREATE TABLE dbm_execucao_permitida (
    id          BIGSERIAL PRIMARY KEY,
    papel_id    BIGINT    NOT NULL REFERENCES dbm_papel(id) ON DELETE RESTRICT,
    schema_nome TEXT,
    funcao      TEXT      NOT NULL,
    ativa       BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_dbm_execucao_permitida ON dbm_execucao_permitida
  (papel_id, COALESCE(schema_nome,''), funcao);
COMMENT ON TABLE dbm_execucao_permitida IS
  'Whitelist de funcao por papel. Lista vazia = nenhuma funcao executavel, e e o '
  'estado correto para Somente Leitura (14.18, 12.8). Tela: embutida na Matriz '
  'de permissoes, aba Execucoes.';

COMMENT ON TABLE dbm_permissao_escopo IS
  'Recorte de schemas/objetos por papel e conexao. No papel Operador isso se '
  'materializa como GRANT SELECT na role dbm_operador do ALVO: o DBM declara, '
  'o banco aplica (0.7). Tela: Matriz de permissoes.';

-- ---------------------------------------------------------------------
-- 5. AUDITORIA -- antes de qualquer escrita (13.10)
--    Particionamento mensal em auditoria E execucao (7.8).
--    Consequencia: a PK tem que incluir a chave de particao. Nenhuma FK
--    aponta para estas duas, entao isso nao custa referencia.
-- ---------------------------------------------------------------------

CREATE TABLE dbm_auditoria (
    id           BIGSERIAL   NOT NULL,
    uuid         UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id   BIGINT      REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    papel        TEXT,
    -- 7.2: de qual origem veio a acao.
    origem       TEXT        NOT NULL DEFAULT 'usuario'
                 CHECK (origem IN ('usuario','job','evento','api')),
    conexao_id   BIGINT      REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    objeto_tipo  TEXT,
    objeto_nome  TEXT,
    schema_nome  TEXT,
    operacao     TEXT,
    resultado    TEXT        NOT NULL
                 CHECK (resultado IN ('ok','falha','negado')),
    erro         TEXT,
    antes        JSONB,
    depois       JSONB,
    -- INET e nao TEXT: a coluna e consultavel por faixa, e o Postgres valida
    -- o endereco na entrada em vez de aceitar "desconhecido".
    ip           INET,
    user_agent   TEXT,
    duracao_ms   BIGINT,
    created_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_dbm_auditoria_conexao ON dbm_auditoria (conexao_id, created_at DESC);
CREATE INDEX ix_dbm_auditoria_usuario ON dbm_auditoria (usuario_id, created_at DESC);
CREATE INDEX ix_dbm_auditoria_objeto  ON dbm_auditoria (objeto_nome, created_at DESC);
COMMENT ON TABLE dbm_auditoria IS
  'Trilha de auditoria, particionada por mes (7.8). Guarda quem, de qual papel, '
  'de qual origem, quando, o que foi afetado, resultado e antes/depois. '
  'Tela: Auditoria > Trilha. Selo de "cobertura parcial" enquanto o event '
  'trigger de 7.4 nao estiver instalado.';

-- 7.3: trilha de SQL e tabela propria porque SQL solto nao tem entidade nem id,
-- e forcar um id ficticio seria inventar dado. `norm_sql` guarda o SQL com
-- literais trocados por ?, que e o que permite agrupar "top consultas" por
-- identidade e nao por texto.
CREATE TABLE dbm_execucao (
    id              BIGSERIAL   NOT NULL,
    uuid            UUID        NOT NULL DEFAULT gen_random_uuid(),
    usuario_id      BIGINT      REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    papel           TEXT,
    conexao_id      BIGINT      REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    sql_text        TEXT        NOT NULL,
    sql_hash        TEXT,
    norm_sql        TEXT,
    tipo            TEXT        CHECK (tipo IN ('SELECT','DML','DDL','DCL')),
    status          TEXT,
    linhas_afetadas BIGINT,
    duracao_ms      BIGINT,
    erro            TEXT,
    ip              INET,
    user_agent      TEXT,
    created_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX ix_dbm_execucao_conexao ON dbm_execucao (conexao_id, created_at DESC);
CREATE INDEX ix_dbm_execucao_hash    ON dbm_execucao (sql_hash);
CREATE INDEX ix_dbm_execucao_usuario ON dbm_execucao (usuario_id, created_at DESC);
-- Parcial sobre falha: o indice do que deu errado e uma fracao do total.
CREATE INDEX ix_dbm_execucao_falha ON dbm_execucao (conexao_id, created_at DESC)
  WHERE status IS DISTINCT FROM 'ok';
COMMENT ON TABLE dbm_execucao IS
  'Auditoria de SQL, particionada por mes. norm_sql substitui literais por ? '
  'para agrupar por identidade. Tela: Auditoria > Trilha (SQL).';

-- 14.10. `motivo` estruturado e o que permite a lista de negacao da 6.7 ser
-- auditada por regra, e nao so por contagem.
CREATE TABLE dbm_negativa (
    id         BIGSERIAL PRIMARY KEY,
    uuid       UUID      NOT NULL DEFAULT gen_random_uuid(),
    usuario_id BIGINT    REFERENCES dbm_usuario(id) ON DELETE RESTRICT,
    conexao_id BIGINT    REFERENCES dbm_conexao(id) ON DELETE RESTRICT,
    sql_text   TEXT,
    motivo     TEXT      NOT NULL
               CHECK (motivo IN ('permissao','lista_negacao','timeout','conexao','cancelamento')),
    regra      TEXT,
    ip         INET,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_dbm_negativa_usuario ON dbm_negativa (usuario_id, created_at DESC);
CREATE INDEX ix_dbm_negativa_ip      ON dbm_negativa (ip, created_at DESC);
COMMENT ON TABLE dbm_negativa IS
  'Tentativas negadas, com o motivo estruturado. Tela: Auditoria > '
  'Tentativas negadas.';

-- ---------------------------------------------------------------------
-- 6. PARTICOES MENSAIS (7.8)
--    Criadas por DO block e nao em SQL fixo, para que a migration valha
--    nao importa a mes em que for aplicada.
--    A particao DEFAULT existe para o INSERT nunca falhar, mas e uma
--    divida: para criar uma particao futura que caiba na DEFAULT, o
--    procedimento e DETACH + ATTACH depois de mover as linhas, nao um
--    CREATE TABLE direto. Isso e manutencao, e esta escrito no COMMENT.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    alvo  TEXT;
    mes   DATE;
    i     INTEGER;
    nome  TEXT;
    ini   TEXT;
    fim   TEXT;
BEGIN
    FOREACH alvo IN ARRAY ARRAY['dbm_auditoria','dbm_execucao'] LOOP
        -- do mes anterior ate tres meses a frente.
        --
        -- A fronteira superior e `((mes + interval '1 month')::date)` e NAO
        -- `mes + 1`: aritmetica de DATE soma UM DIA, e eu ja escrevi isso
        -- achando que somava um mes. A migration rodava, criava
        -- dbm_auditoria_2026_09 e a particao ia de 09-01 a 09-02 -- um dia
        -- com o nome de um mes. Nao dava erro: a gravacao de hoje caia na
        -- particao DEFAULT e o DEFAULT crescia sem ninguem ver. So apareceu
        -- porque o teste de gravacao perguntou em qual particao a linha tinha
        -- parar, e a resposta foi a particao errada.
        --
        -- O cast para ::date e obrigatorio: sem ele `date + interval` vira
        -- timestamp e o ::text devolvia "2026-10-01 00:00:00", que com o
        -- sufixo " 00:00:00" virava timestamp invalido. Foi a primeira
        -- versao deste bloco, e ela falhou no migrate.
        FOR i IN -1..3 LOOP
            mes  := (date_trunc('month', now()) + (i || ' month')::interval)::date;
            nome := alvo || '_' || to_char(mes, 'YYYY_MM');
            ini  := to_char(mes, 'YYYY-MM-DD') || ' 00:00:00';
            fim  := to_char((mes + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00';
            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                nome, alvo, ini, fim);
            -- regra 7 do cabecalho tambem nas particoes: quem abrir \d em
            -- qualquer mes novo precisa saber do que ela e fatia
            EXECUTE format('COMMENT ON TABLE %I IS %L',
                nome, 'Fatia mensal de ' || alvo || ' para ' || to_char(mes, 'YYYY-MM') || '.');
        END LOOP;
        EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT', alvo || '_default', alvo);
    END LOOP;
END $$;

COMMENT ON TABLE dbm_auditoria_default IS
  'Rede de seguranca contra INSERT falhar. Para criar particao futura que caia '
  'nesta faixa: DETACH, criar a particao, ATTACH e mover as linhas. Sem '
  'isso o ATTACH falha.';
COMMENT ON TABLE dbm_execucao_default IS
  'Rede de seguranca contra INSERT falhar. Mesma manutencao de DETACH/ATTACH '
  'de dbm_auditoria_default.';

-- ---------------------------------------------------------------------
-- 7. SEMENTE -- papeis e permissoes (13.8), e chaves (14.19)
--    Semeado aqui e nao em outra migration, porque sem papel o DBM sobe sem
--    ninguem ver nada, que e o outro jeito de "ninguem sabia".
-- ---------------------------------------------------------------------

INSERT INTO dbm_papel (nome, descricao, origem) VALUES
  ('ROLE_ASTRAL_USER',  'Usuario autenticado no Astral',                'astral'),
  ('ROLE_ASTRAL_ADMIN', 'Administrador do Astral',                      'astral'),
  ('ROLE_SUPERUSER',    'Superusuario sem permissao de drop de banco',  'astral'),
  ('ROLE_SUPERADMIN',   'Superusuario com permissao de drop de banco',  'astral');

-- 13.8 diz que SUPERADMIN e "tudo" e que SUPERUSER e "como admin, sem
-- drop_database". "Tudo" nao e lista, entao a leitura adotada esta escrita
-- aqui para ser revisavel: SUPERUSER = conjunto do ADMIN + administracao e
-- deploy, SEM drop_database; SUPERADMIN = o mesmo conjunto + drop_database.
INSERT INTO dbm_permissao (papel_id, permissao)
SELECT p.id, v.permissao
FROM dbm_papel p
JOIN (VALUES
    ('ROLE_ASTRAL_USER', 'dbm.connect'),
    ('ROLE_ASTRAL_USER', 'dbm.browse'),
    ('ROLE_ASTRAL_USER', 'dbm.query.read'),

    ('ROLE_ASTRAL_ADMIN','dbm.query.read'),
    ('ROLE_ASTRAL_ADMIN','dbm.connect'),
    ('ROLE_ASTRAL_ADMIN','dbm.browse'),
    ('ROLE_ASTRAL_ADMIN','dbm.query.write'),
    ('ROLE_ASTRAL_ADMIN','dbm.ddl'),
    ('ROLE_ASTRAL_ADMIN','dbm.audit.read'),
    ('ROLE_ASTRAL_ADMIN','dbm.audit.export'),
    ('ROLE_ASTRAL_ADMIN','dbm.restore'),

    ('ROLE_SUPERUSER',   'dbm.query.read'),
    ('ROLE_SUPERUSER',   'dbm.connect'),
    ('ROLE_SUPERUSER',   'dbm.browse'),
    ('ROLE_SUPERUSER',   'dbm.query.write'),
    ('ROLE_SUPERUSER',   'dbm.ddl'),
    ('ROLE_SUPERUSER',   'dbm.audit.read'),
    ('ROLE_SUPERUSER',   'dbm.audit.export'),
    ('ROLE_SUPERUSER',   'dbm.restore'),
    ('ROLE_SUPERUSER',   'dbm.admin.manage'),
    ('ROLE_SUPERUSER',   'dbm.credentials.read'),
    ('ROLE_SUPERUSER',   'dbm.deploy'),
    ('ROLE_SUPERUSER',   'dbm.deploy.approve'),

    ('ROLE_SUPERADMIN',  'dbm.query.read'),
    ('ROLE_SUPERADMIN',  'dbm.connect'),
    ('ROLE_SUPERADMIN',  'dbm.browse'),
    ('ROLE_SUPERADMIN',  'dbm.query.write'),
    ('ROLE_SUPERADMIN',  'dbm.ddl'),
    ('ROLE_SUPERADMIN',  'dbm.audit.read'),
    ('ROLE_SUPERADMIN',  'dbm.audit.export'),
    ('ROLE_SUPERADMIN',  'dbm.restore'),
    ('ROLE_SUPERADMIN',  'dbm.admin.manage'),
    ('ROLE_SUPERADMIN',  'dbm.credentials.read'),
    ('ROLE_SUPERADMIN',  'dbm.deploy'),
    ('ROLE_SUPERADMIN',  'dbm.deploy.approve'),
    ('ROLE_SUPERADMIN',  'dbm.drop_database')
) AS v(papel, permissao) ON v.papel = p.nome;

INSERT INTO dbm_configuracao (chave, valor, tipo, descricao) VALUES
  ('dbm.linhas_max',             '1000',  'inteiro',
   'Teto de linhas por resultado. Tela: Conexoes > Editar conexao e barra do editor.'),
  ('dbm.timeout_leitura_ms',     '30000', 'inteiro',
   'statement_timeout da leitura. Tela: Conexoes > Editar conexao.'),
  ('dbm.transacao_timeout_ms',   '0',     'inteiro',
   'Timeout da transacao aberta; 0 = sem limite. Tela: Conexoes > Editar conexao.'),
  ('dbm.retener_auditoria_meses','24',    'inteiro',
   'Retencao da trilha, meses (7.8). Tela: Auditoria > Retencao e politica.'),
  ('dbm.allow_risco',            'true',  'booleano',
   'Liga o Query Risk. Tela: Inteligencia > Analisador de Query.');

-- ---------------------------------------------------------------------
-- 8. AUTOVALIDACAO
--    A migration verifica a si mesma. Se alguma regra do cabecalho for
--    violada aqui, ela falha aqui -- e nao seis meses depois, quando
--    alguem procurar uma tabela que ninguem sabia que existia.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    esperado  TEXT[] := ARRAY[
      'dbm_usuario','dbm_papel','dbm_configuracao','dbm_grupo_conexao',
      'dbm_conexao','dbm_sessao_historico','dbm_historico_query','dbm_favorito',
      'dbm_snippet','dbm_permissao','dbm_permissao_escopo','dbm_auditoria',
      'dbm_execucao','dbm_negativa','dbm_driver','dbm_execucao_permitida'];
    faltando  TEXT[];
    vazando   TEXT[];
    FKs       RECORD;
BEGIN
    -- 1. as 16 tabelas da V100 existem
    SELECT array_agg(t.nm) INTO faltando
    FROM unnest(esperado) AS t(nm)
    WHERE to_regclass(t.nm) IS NULL;
    IF faltando IS NOT NULL THEN
        RAISE EXCEPTION 'V100: faltou criar %', faltando;
    END IF;

    -- 2. nenhuma coluna proibida (0.15, 0.18)
    SELECT array_agg(DISTINCT table_name || '.' || column_name) INTO vazando
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND (column_name = 'empresa_id' OR table_name LIKE 'bc\_%');
    IF vazando IS NOT NULL THEN
        RAISE EXCEPTION 'V100: coluna proibida em %', vazando;
    END IF;

    -- 3. nenhuma senha de login (0.19): hash nao pode existir em lugar
    --    nenhum do proprio banco do DBM
    SELECT array_agg(table_name || '.' || column_name) INTO vazando
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('senha_hash','password','senha');
    IF vazando IS NOT NULL THEN
        RAISE EXCEPTION 'V100: coluna de senha de login em % (0.19.2)', vazando;
    END IF;

    -- 4. regra de 14: trilha nunca CASCADE, nunca SET NULL
    FOR FKs IN
        SELECT con.conrelid::regclass::text AS tabela, con.confdeltype AS acao
        FROM pg_constraint con
        WHERE con.contype = 'f' AND con.connamespace = current_schema()::regnamespace
    LOOP
        IF FKs.acao IN ('c','n') THEN
            RAISE EXCEPTION 'V100: FK de % usa % (cascade ou set null); 14 exige RESTRICT',
                FKs.tabela, FKs.acao;
        END IF;
    END LOOP;

    -- 5. auditoria e execucao particionadas (7.8)
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='dbm_auditoria'
                     AND relkind='p') THEN
        RAISE EXCEPTION 'V100: dbm_auditoria nao esta particionada (7.8)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='dbm_execucao'
                     AND relkind='p') THEN
        RAISE EXCEPTION 'V100: dbm_execucao nao esta particionada (7.8)';
    END IF;

    -- 6. `source` nao pode voltar a ser enum fechado (0.22.3): a autenticacao
    --    esta em evolucao e a fonte seguinte (validacao por Linux) e real.
    --    Um CHECK de dois valores rejeitaria um login legitimo, e o sintoma
    --    seria o usuario existir na fonte e nao ter perfil no DBM.
    IF EXISTS (SELECT 1 FROM pg_constraint con
               WHERE con.connamespace = current_schema()::regnamespace
                 AND con.contype = 'c' AND con.conrelid = 'dbm_usuario'::regclass
                 AND pg_get_constraintdef(con.oid) LIKE '%source%') THEN
        RAISE EXCEPTION 'V100: dbm_usuario.source virou enum fechado; a fonte de identidade esta em evolucao (0.22.3)';
    END IF;

    -- 7. a regra "verificado so com checksum" precisa EXISTIR, e nao basta
    --    nao haver nada errado: sem o CHECK a migracao passa igual e o
    --    registro fica marcado como verificado sem ter sido conferido.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE connamespace = current_schema()::regnamespace
                     AND conrelid = 'dbm_driver'::regclass AND contype = 'c'
                     AND pg_get_constraintdef(oid) LIKE '%checksum_sha256%') THEN
        RAISE EXCEPTION 'V100: dbm_driver sem a regra verificado -> checksum (14.20)';
    END IF;

    -- 8. `driver` nao pode voltar a ser texto livre em dbm_conexao: e o
    --    que faria a conexao ser salva e falhar so ao abrir (14.20)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = current_schema()
                 AND table_name = 'dbm_conexao' AND column_name = 'driver') THEN
        RAISE EXCEPTION 'V100: dbm_conexao.driver voltou a ser coluna solta; use driver_id FK (14.20)';
    END IF;

    -- 9. semente presente: sem papel, o DBM sobe sem ninguem ver nada
    IF (SELECT count(*) FROM dbm_papel) < 4 THEN
        RAISE EXCEPTION 'V100: semente de dbm_papel incompleta (13.8)';
    END IF;
    IF (SELECT count(*) FROM dbm_configuracao) < 5 THEN
        RAISE EXCEPTION 'V100: semente de dbm_configuracao incompleta (14.19)';
    END IF;
END $$;
