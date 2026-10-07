# Astral Database Manager — Especificação Funcional e Arquitetural

Módulo de administração de banco de dados para **Astral HCI-NGFW** e **BrasilCloud ERP**.
Inspirado em InterBase Administration, IBExpert, FlameRobin, DBeaver, DataGrip,
Enterprise Manager e pgAdmin.

Este documento é uma especificação de implementação. Não é uma lista de recursos.

---

## 0. Base medida, decisões e o que NÃO está decidido

### 0.1 O que existe hoje (medido no servidor, 29/09)

Não partimos do zero, e isso muda decisões de arquitetura:

| Fato medido | Onde | Consequência para este módulo |
|---|---|---|
| Java 21, Spring Boot 3.3.5 | `BrasilCloudERP/pom.xml` | O módulo nasce dentro do mesmo build |
| Flyway em `V99__nfse_retorno_colunas_base.sql` | `db/migration/` | A migração do módulo é `V100__dbm_inicial.sql` |
| PostgreSQL como datastore | `spring.datasource.*` | O banco do sistema é Postgres; o módulo gerencia **outros** bancos |
| `bc_core_auditoria` já existe: `id, uuid, empresa_id, usuario_id, tabela, registro_id, operacao, antes JSONB, depois JSONB, ip, user_agent, created_at` | `V2__core.sql:126` | Reaproveitar o padrão, **não** duplicar. Falta o caso "SQL solto", tratado em §7.3 |
| `bc_core_configuracao` existe: `chave, valor, descricao` | `V2__core.sql` | Config de feature flag e limites vive aqui |
| `JwtAuthenticationFilter`, `ExigeEmpresaFilter`, `ModuloAcessoFilter` | `shared/security/` | Identidade e multiempresa já viajam na requisição. Não inventar outro caminho |
| `ApiResponse` | `shared/dto/` | Todo endpoint novo devolve o mesmo envelope |
| Roles divergentes: ERP `ROLE_ADMIN`/`ROLE_SUPERUSER`/`ROLE_SUPERADMIN`; Astral `ROLE_ASTRAL_ADMIN`/`ROLE_ASTRAL_USER` | medido nos dois repos | Precisamos de **uma matriz de permissão do módulo**, não de roles novas |
| `MultiSourceAuthenticationProvider` com LDAP e AD | `astral/main/security/` | SSO e AD entram por fonte de identidade, sem código novo |
| `setup-kerberos-auth.sh` | `astral-plataform-hci` | Kerberos é desbloqueio de host, não de banco. Não_priority |
| `pgcrypto`, `uuid-ossp`, `unaccent`, `vector` | migrações do ERP | Fato do ERP, e **não** herança: extensão é por banco (§0.24). O DBM não consome nenhuma delas |
| PrimeReact `^10.8.0` + Vite | `static/react/` | A UI nova usa PrimeReact; alinhar componente com ele |

### 0.2 Decisões de arquitetura (tomadas aqui, não em 15 lugares diferentes)

**D1 — JDBC-first, Driver Manager, e adaptadores só para capacidades.** Reescrito
pelo dono em 29/09 (era "adaptador por SGBD", que implicava roadmap por banco).

A camada de **conexão é 100% JDBC genérico** — `DriverManager`, `DatabaseMetaData`,
`ResultSet`. Qualquer banco com driver JDBC conecta, navega e roda SQL sem nenhuma
linha de código específica.

Os adaptadores (`PostgreSqlTarget`, `FirebirdTarget`, `InterBaseTarget`, `MySqlTarget`,
`SqlServerTarget`, `OracleTarget`) **não conectam**. Eles existem só para o que o JDBC
não padroniza: Explain, Locks, Replication, Tablespaces, Jobs, Backup/Restore,
Performance, sessões, catálogos proprietários. Adapter ausente = Nível 1 (§0.9).

A divisão de referência: **experiência** vem de InterBase Administration e IBExpert
(§1, §2, §3, §12). **Conectividade** vem do DBeaver: download e cache de drivers.
Implementar JDBC uma vez, e o adaptador foca só no avançado.

**D2 — A navegação em árvore é metadado, não consulta.** `information_schema` e os catálogos
nativos viram um `ArvoreObjeto` em memória. A UI só consome. Isso permite cache, busca global
e diff sem consultar o banco a cada clique.

**D3 — Escrita é negada por padrão no caminho de navegação.** Navegar objeto (listar colunas,
ver índices) usa **conexão somente-leitura** (role Postgres `SET TRANSACTION READ ONLY`, ou
conta de usuário sem privilégio de escrita). Só o caminho explícito de execução de DDL/DML
abre transação de escrita, e esse caminho é o único que exige confirmação e gera auditoria.

**D4 — O módulo nunca dá `COMMIT` sozinho.** Todo DDL/DML roda dentro de transação explícita
controlada pelo usuário. Botão separado para confirmar. Isso é o que separa uma ferramenta
de produção de uma ferramenta que derruba banco.

**D5 — Limite de tempo e de linhas é do servidor, não da UI.** `statement_timeout` e teto de
linhas applied **na conexão**, porque um `LIMIT` no cliente não protege um `UPDATE` de 40 milhões
de linhas.

**D6 — Credencial nunca volta ao navegador.** A senha é cifrada em repouso (cifra da
aplicação, chave de ambiente) e a API devolve apenas máscara. O navegador nunca vê a senha,
nem em "editar conexão".

**D7 — Auditoria de duas fontes.** O que o módulo executa, ele registra. O que alguém executa
por `psql`, é capturado por **event trigger** do Postgres (§7.3). Sem o trigger, a trilha é
auto-relato e não vale como auditoria.

**D8 — Isolar o banco do próprio sistema.** Registrar o `ASTRAL_DB_URL` do próprio Astral como
conexão é proibido no caminho genérico. Um `DROP DATABASE` pela ferramenta não pode levar junto
o banco que guarda a lista de conexões. O caminho de exceção exige papel dedicado e aprovação (§11).

### 0.3 Decisões do dono (29/09) — fechadas

Estas três estavam em aberto na primeira versão. Foram decididas:

**Escrita em produção: SIM, e desligada por padrão.** Modelo em três degraus:
leitura → escrita controlada → bypass auditado. A recusa é explícita: não é um
DBeaver corporativo que só consulta. A permissão continua deciding quem escreve;
"desligada por padrão" é o estado da *conexão* (§0.4), não a ausência da permissão.

**Firebird/InterBase: entra, mas não na V100.** Primeira entrega é PostgreSQL.
A porta `BancoTarget` (§13.2) já é o ponto de extensão, e o roteiro de dialecto
está em §0.5. Firebird e InterBase compartilham o mesmo dialeto, que é o caso
mais barato de todo o roteiro.

**Banco do módulo: banco próprio, `astral_dbm`.** Decisão do dono (29/09), que
inverte a original. Prefixo das tabelas: `dbm_`, a sigla do *Astral Database
Manager* — o nome do banco já carrega `astral`, então prefixar de novo seria
redundância. Ver §0.16, §0.17 e §0.18.

**Papéis finais: três, e o Operador exige role própria no banco.** A garantia
de que Operador não escreve **não pode viver só no Spring** — ela tem que existir
também no banco alvo. Papel "Somente Leitura" (Desenvolvedor/Auditor/Analista) não
nem enxerga dados nem exporta; papel Operador consulta e exporta dentro de
limites, com `dbm_operador` no banco; papel DBA faz tudo, auditado. Regra nova, §0.7.

**Nenhum botão de Restore sem ambiente de staging.** Promovido de observação
para **requisito obrigatório** (§15.3), com o critério de aceite em §15.4.

---

### 0.4 "Desligada por padrão" — o que exatamente a frase significa

A permissão decide *quem* escreve. "Desligada por padrão" é o estado inicial da
**conexão**, e precisa virar regra verificável, senão é frase:

1. **Conexão nova nasce em `somente_leitura = true`.** O usuário tem de liberar
   a escrita explicitamente, na conexão ou na sessão (§12.8).
2. **Liberar escrita é ato deliberado e visível**: exige `dbm.query.write`, grava
   auditoria, e a barra da tela passa a mostrar "ESCRITA" em destaque, não em
   cinza discreto. Escrever é o estado excepcional e tem que parecer.
3. **A liberação não persiste.** Reabrir a sessão volta a leitura. Concentração
   forçada; o custo é inconvenience, e inconvenience é o preço justo.
4. **O botão de `DROP DATABASE` é mais pesado ainda:** além de `dbm.ddl`, exige
   `dbm.admin.manage`, backup verificado e confirmação digitada (§4.1). Poucas
   ocorrências, por isso o peso.
5. **Fechar a aba mantém a liberação até o fim da workbench**, não até o fim do
   dia. Workbench é a unidade de trabalho e a unidade de risco.

O estado por conexão vive em `dbm_conexao.somente_leitura` (§14.2); o estado
efetivo por sessão fica em Redis, porque é volátil por definição.

### 0.5 Driver Manager — conectividade universal (JDBC-first)

Fechado pelo dono em 29/09. Substitui o roadmap "um banco por versão" por um
**catálogo de drivers**. Modelo do DBeaver, aplicado só à conectividade.

Fluxo do usuário ao escolher um banco:

```
Astral SQL Manager → Driver Manager → JDBC Driver → Banco de Dados
```

1. Administrador escolhe o banco (Oracle, Firebird, MySQL, ...)
2. O Driver Manager verifica se o driver existe no cache local
3. **Se existe**: usa, e a conexão é genérica JDBC
4. **Se não existe**: baixa, confere checksum, registra, ativa
5. Conexão criada via `DriverManager` — sem implementação específica

Bancos que o catálogo cobre desde a V100: PostgreSQL, Firebird, InterBase, MySQL,
MariaDB, SQL Server, Oracle, SQLite, DB2, SAP HANA, Informix, Sybase, Teradata,
CockroachDB, YugabyteDB, TimescaleDB, H2, Derby.

Tabela nova `dbm_driver` (§14.20): `id, nome, fabricante, versao, jdbc_class,
jdbc_url_template, download_url, checksum_sha256, assinatura, ativo, cache_path,
baixado_em, tamanho_bytes`.

O Driver Manager é responsável por: catálogo, download, versionamento, atualização,
checksum, assinatura, cache local, ativação e desativação. Drivers baixados ficam
em disco sob `dbm/drivers/<fabricante>/<versao>/`, e são carregados com classloader
isolado por driver — dois drivers com a mesma classe não colidem.

**Medido nesta máquina:** o ERP hoje tem `h2` e `postgresql` no `pom.xml`; o
**Jaybird (driver JDBC do Firebird/InterBase) não está no sistema**, e o Maven
Central responde (HTTP 200). Ou seja, Firebird/InterBase dependem inteiramente do
download pelo Driver Manager na V100 — não há driver embutido para eles.

**Compatibilidade universal (Nível 1) desde a V100**, sem código por banco:
conexão, execução SQL, SQL editor, metadados, schemas, tabelas, views, colunas,
ResultSet, exportação, histórico, favoritos, auditoria e RBAC.

### 0.6 Schema `dbm` no banco do ERP: por que não um banco separado

> **SUPERADA em 29/09 pela §0.14.** O dono decidiu que cada projeto tem banco
> próprio e que o SQL Manager é componente do Astral. O argumento abaixo foi escrito
> para um módulo dentro do ERP e **vale como registro do que foi pensado**, não como
> conclusão atual. O que continua vivo dele: o isolamento que se quer é de **permissão**,
> não de schema — e isso continua verdade no banco do Astral. O que morreu: reusar
> `bc_core_auditoria` e `empresa_id`. Ver §0.15 para o custo medido.

**Argumento superado em 29/09.** O dono decidiu banco próprio (`astral_dbm`, §0.16), e
o argumento abaixo — a favor do banco compartilhado — fica registrado só para não se
repetir a discussão. Os três pontos que o sustentavam deixaram de valer:

1. A trilha **não** atravessa mais limite: `dbm_auditoria` é do DBM e fica no banco do
   DBM (§7.1, §14.8). `bc_core_auditoria` morreu como dependência.
2. Credencial separada deixa de ser custo: cada projeto tem seu usuário e seu banco
   (§0.14), então não há um usuário com privilégio em dois bancos.
3. O isolamento que se quer **é** de banco, e é mais forte que permissão. A permissão
   `dbm.*` sobre o escopo do token continua valendo (§6.3), mas é a segunda linha de
   defesa, não a primeira.

**O que sobrevive desta seção é a regra de defesa em profundidade logo abaixo**, que não
depende de onde o banco mora. O que não sobrevive:

- A trilha é `bc_core_auditoria`, que fica em `public` junto do resto do ERP, com
  FK para `bc_core_empresa` e `bc_core_usuario`. Schema separado para o resto do
  módulo é possível, mas **a trilha atravessa o limite** de qualquer jeito: ou
  duplica a trilha, ou faz consulta cruzando schema com permissão do dono do schema.
- Banco separado significa credencial separada para o módulo gerenciar o banco do
  ERP — e credencial com privilégio em dois bancos é pior que uma só.
- O isolamento que se quer não é de banco, é de **permissão**, e permissão já é
  `dbm.*` sobre o escopo do token — usuário e papel (§6.3). Schema não acrescenta o que a
  permissão não faz.

O que a decisão exige, e é o risco a administrar:

- `search_path` do módulo: `public` dentro de `astral_dbm`. **Sem schema `dbm`** — o
  banco já é do DBM, e schema separado só faria sentido em banco compartilhado (§14).
  Um `search_path` apontando para `astral` por engano é erro de configuração, e é
  erro que o `validate` do Flyway (§0.16) pega na subida.
- Revisão de `search_path` e de referência sem schema nas queries do módulo — risco
  registrado em §15.2. As duas referências órfãs que existiam aqui (15.5 e 15.6,
  ambas com parágrafo mas sem subseção) apontavam para o vazio; corrigidas nesta passagem.


### 0.7 Regra de defesa em profundidade — o SQL Manager nunca é a única camada

Fechada pelo dono em 29/09. Onde há duas decisões de segurança, a mais forte
vence, e as duas precisam concordar.

```
camada 1  aplicacao   Spring Security + matriz dbm.* + executor (§6, §7)
camada 2  banco       role propria no banco alvo (dbm_leitura, dbm_operador)
```

Se as duas discordarem, o banco vence, e a divergencia e registrada como bug de
configuracao de RBAC, nao como "operacao negada".

**Modos e onde cada garantia mora:**

| Papel | No banco | No Spring | Exporta |
|---|---|---|---|
| Somente Leitura | `dbm_leitura` | `dbm.query.read` | **Nao** |
| Operador | `dbm_operador` | `dbm.query.read` | Sim, ate `max_linhas_exportacao` |
| DBA | conexao do dono | `dbm.ddl`, `dbm.query.write` | Sim, sem teto |

Somente Leitura **nao** exporta: e o papel de quem abre o banco para ver estrutura.
Exportacao e o que o DBA faz quando quer dados; para o Leitura seria um caminho
innecessario para vazar o mesmo dado.

**O problema e efeito, nao verbo.** A negacao §6.7 e avaliada por analise do plano
de execucao, nao pelo verbo SQL, e roda em leitura e em escrita (§6.7.1).

**Consequencia que precisa virar regra:** o banco alvo pode ser qualquer um dos
SGBDs de §0.5. O Postgres tem `REVOKE EXECUTE ... FROM PUBLIC`; Firebird, MySQL e
Oracle nao tem nada equivalente. Ate `refresh_materialized_view`, que e um
`SECURITY DEFINER` do proprio Postgres, o Operador nao deve executar. Logo:

- **Postgres**: `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA s FROM PUBLIC`, mais
  `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Fecha.
- **Firebird / MySQL / Oracle**: nao existe revogacao de execucao. A camada de
  banco **nao fecha** o furo da funcao ali; so a aplicacao fecha.

Isso fica registrado como limitacao conh e cida, e o modulo **avisa que o Operador
esta mais fraco em SGBDs sem revogacao de execucao** — em vez de prometer a mesma
garantia nos seis.

### 0.8 Quais bancos podem ser Certificados (e o custo real)

Definição do dono: Firebird, InterBase e PostgreSQL inicialmente. Registrado o custo,
porque "certificado" não é de graça:

- Não existe servidor Firebird/InterBase nesta máquina (medido: sem serviço, sem pacote).
- Não existe Jaybird no sistema (medido). Servidor e driver chegam pelo Driver Manager.
- **Certificar exige um servidor de verdade para testar.** Um adaptador de InterBase que
  nunca rodou contra um InterBase é código não verificado — exatamente o que a §15.3
  proíbe para restore.

Então, honestamente: a V100 entrega **Nível 1 universal** (Postgres e H2 Testcontainers já
no `pom.xml`) e deixa Firebird/InterBase como **Nível 2 pendente de ambiente**, com o
primeiro servidor Firebird instalado. Certificação só é declarada depois de um teste
automatizado rodando contra o banco real.

### 0.9 Níveis de suporte

Definido pelo dono em 29/09. Três níveis, e a UI **mostra o nível do banco em que o usuário
está conectado** — nivel nao declarado e marketing que vira reclamação.

**Nível 1 — Compatível.** Tem driver JDBC.
Conecta, executa SQL, edita e consulta dados, exporta, audita, navega em metadados.
Funciona para qualquer banco com driver, sem código específico.

**Nível 2 — Suportado.** Tem adaptador.
Nível 1 mais: monitoramento, administração, Explain, Locks, sessões, deadlock,
replicação, performance, recursos proprietários.

**Nível 3 — Certificado.** Banco validado oficialmente. Só se declara com execução
contra o ambiente real (§0.10): teste contra mock ou H2 não certifica InterBase.
Nível 2 mais: suíte de testes automatizados rodando contra o banco real, documentação
de comportamento e cobertura funcional declarada.

Implementação: `SuporteNivel` enum (COMPATIVEL, SUPORTADO, CERTIFICADO) por
`fabricante+fabricante` na tabela `dbm_driver`, e a **UI degrada com honestidade** —
num banco Nível 1, o menu Explain fica visível mas desabilitado com o motivo "requer
adaptador", em vez de sumir ou aparecer quebrado.

### 0.10 Diretriz operacional — servidor é o ambiente oficial de desenvolvimento

Regra do projeto, de 29/09, que vale para o SQL Manager, para o ERP, para o Astral e
para qualquer módulo futuro. Ela não é preferência de ambiente: nasceu de três
incidentes concretos.

**A regra:** todo desenvolvimento acontece no servidor. O notebook é **estação
cliente** — faz `git pull`, consulta, documentação, validação e acesso. Nada além
disso. Nenhuma build, nenhum teste de integração, nenhuma execução de SQL de
aplicação no notebook.

**Origem da regra (motivos registrados):**

1. *Incidente de hardware.* O notebook travou por cerca de uma hora antes de uma
   entrevista de inglês. Subir outro Linux, recuperar ambiente e entrar na entrevista
   custou arquivos locais. A diretriz existe para que a maquina que segura o trabalho
   não seja a mesma que pode travar.
2. *Backup e versionamento centralizados.* Com tudo no servidor: git, branches,
   snapshots, backups, versões paralelas e múltiplas implementações do mesmo módulo,
   sem depender de um único computador.
3. *Incidente de rastreabilidade no Astral.* Uma IA alterou código, não documentou
   o que alterou e não informou o impacto — e o Astral perdeu cerca de metade do
   trabalho concluído. O problema não foi o código, foi a falta de rastreabilidade.

**Consequências para este módulo:**

- Drivers JDBC, catálogo de drivers, downloads e cache de drivers são recursos **do
  servidor** (`dbm/drivers/...`). **Nunca** do navegador, nunca do notebook. Ver §0.11.
- Nenhuma funcionalidade é declarada **certificada** sem execução contra um ambiente
  real do banco correspondente (§0.8, §0.9 N3). Teste contra mock ou H2 não certifica
  InterBase; H2 certifica H2.
- Toda alteração entra por commit com o que mudou e o impacto, porque o incidente 3
  foi de rastreabilidade e não de conteúdo.

**Filosofia que a diretriz formaliza** e que é o critério de honestidade do módulo:
**validado > assumido, medido > suposto.** Uma capacidade só entra no documento como
suportada depois de observada funcionando no ambiente real do banco que dice suportar.

### 0.11 Cache de driver é recurso do servidor, nunca do navegador

Consequência direta de §0.10 que vale mais que a regra, porque é a que impede a
reincidência do incidente 1.

Na primeira redação do Driver Manager (§0.5), o cache de drivers era do navegador. Isso
está errado por três motivos, e o primeiro é o pior:

1. **O cache no navegador volta a centralizar trabalho em um computador que pode
   travar** — exatamente o que a diretriz veio para acabar. O notebook é o navegador. O
   driver baixado no notebook morre com ele.
2. **Navegador não é lugar de driver JDBC.** JDBC roda no servidor Java; um driver no
   cliente não conecta em nada. Driver no navegador é categorização errada do
   local, não só de armazenamento.
3. **Assinatura e checksum de driver** (§0.5) não querem dizer nada no cliente: a
   verificação precisa acontecer onde o driver vai rodar, ou não verifica nada.

Então: download, cache, checksum e ativação de driver são **todos no servidor**, sob
`dbm/drivers/<fabricante>/<versao>/`, com classloader isolado. O navegador nunca vê
byte de driver. Se o driver não está no servidor, o Servidor o baixa; o usuário não
baixa nada. O espelho é o que a §15.3 já exigia para backup ("nada de restore sem
staging") aplicado ao driver: **nada de driver ativo sem estar no servidor**.

### 0.12 Tags de marco funcional

Decisão do dono em 29/09: o desenvolvimento **não é bloqueado** esperando staging,
restore ou homologação de Firebird/InterBase. Em vez de bloquear, o marco é registrado
com **tag no git**, no primeiro ponto em que a funcionalidade é realmente real.

Regra: tag só quando o marco **funciona**, não quando o código existe. E nenhuma
funcionalidade é certificada sem execução contra o ambiente real do banco (§0.10) — a
tag registra o marco, não certifica o banco.

| Tag | Marco |
|---|---|
| `dbm-v100-alpha` | Conecta, abre Explorer, lista objetos, executa SQL, retorna ResultSet |
| `dbm-v100-query-editor` | Editor completo: autocomplete, plano, histórico, favoritos, exportação |
| `dbm-v100-driver-manager` | Catálogo, download, checksum, cache local, ativação |
| `dbm-v100-auditoria` | `dbm_execucao`, `dbm_negativa`, event trigger ou selo de parcial |
| `dbm-v100-operador` | Papel Operador com role no banco e limite de exportação |
| `dbm-v101` | Primeira entrega com backup verificado (depois de staging, §15.3) |

`dbm-v100-alpha` é o primeiro marco e é o que o dono pediu para registrar: **o primeiro
ponto funcional do produto**.

### 0.13 Servidor compartilhado — isolamento obrigatório

Decisão do dono em 29/09. A máquina não é do SQL Manager. Ela roda **ERP, Astral,
microsserviços fiscais, RabbitMQ, Redis** e o SQL Manager. Tudo que o módulo faz é
precisamente mexer em infra que é dos outros, então o isolamento não é opcional.

**Não tocar, porque é de todos:**

| Recurso | Por quê |
|---|---|
| Configurações globais (`/etc`) | Afeta ERP, Astral, AD, firewall |
| Drivers globais (`/usr/share/java`) | Afeta o build e a classpath de todo mundo |
| Tomcat compartilhado | Afeta o ERP (8080) e o Astral |
| Java compartilhado | Versão é build-wide; §0.1 mediu Java 21 e o pom pede 21 |
| PostgreSQL compartilhado | Mesmo servidor, bancos `brasil-saas` e `astral` (medido) |
| Portas já usadas | Ver lista medida abaixo |

**Usar sempre isolado:**

```
dbm/                  instalação e estado do módulo
dbm/drivers/          cache de drivers (§0.11) — classloader isolado por driver
dbm/cache/            catálogo de metadados, planos, export
dbm/config/           configuração do módulo
dbm/log/              log próprio, nunca o global
```

**Portas medidas em uso** (29/09): 22, 53, 80, 81, 88, 135, 139, 389, 443, 445, 464, 636,
953, 3128, 3268, 3269, 4369, 4568, 4569, 5353, **5432**, 5672, 6379, 8040, **8080**,
8081, 8082, 8091, 9000, 9001, 9090, 15672, 25672, 27017, 38874.

Livres e candidatas: **8083**, 8084, 8085, 8092, 8093, 8443, 9443.

Candidata do DBM: **8083**. Antes de fixar, precisa bater no `nginx` — que tem upstream
para 8080, 8081 e 8082 e cujas configs não são legíveis sem privilégio. Porta escolhida sem
cruzar com o nginx é como dois serviços nascem disputando o mesmo socket.

`4567` e `4568` já são do ERP (fiscal) e **não** são do módulo.

### 0.14 Um banco por projeto — diretriz do dono (29/09), e ela reverte a §0.6

**Decisão:** cada projeto tem o seu banco. O banco do Astral é outro, diferente do
banco dos demais projetos. Projetos podem conversar entre si; **conversar não é
fundir banco**.

**Medido no servidor (29/09):**

| Banco | Projeto | Usuário | Schema | Migration |
|---|---|---|---|---|
| `astral` | Astral | `astral` | `public` (16 tabelas) | **nenhuma** |
| `brasil-saas` | ERP | — | `brasil_saas` | Flyway, em V99 |
| `postgres` | manutenção | `postgres` | — | — |

Os dois estão no **mesmo servidor PostgreSQL (5432)**, em bancos distintos. Isso já era
um fato medido; a diretriz agora transforma em regra.

**Consequência de classificação, atualizada em 29/09.** A versão anterior desta linha
dizia que o SQL Manager "passa a ser componente do Astral — código em
`~/astral-plataform-hci`, namespace `com.astral.dbm`, banco `astral`, schema `dbm`".
Isso foi **superado e não vale mais**: o dono decidiu que o DBM é produto próprio, com
repositório, aplicação, banco e Flyway próprios (§0.16), em repositório `astral_dbm`
separado do Astral e do ERP. Ver §0.22.4 para as alternativas avaliadas e por que a de
"módulo dentro do Astral" foi recusada. A linha "módulo do ERP" da §0.6 também está
superada. Isto é infraestrutura de banco, e a classificação correta agora é produto
independente — não componente de ninguém.

**O nome `V100__dbm_inicial.sql` sobrevive.** Flyway não exige começar em `V1` — aceita
qualquer número. E o Flyway do DBM (o próprio, no repositório `astral_dbm`) começa com
uma única migração, na versão 100. Um número alto também marca "baseline tardia, depois
dos outros projetos", que é a intenção. A numeração é do DBM e independe do ERP.

### 0.15 O que a diretriz do banco invalida, e o que isso custa

A §0.6 foi escrita para um módulo dentro do ERP. Com banco próprio, trêsalidades dela
morrem. Não é um ajuste de texto: é trabalho de código e de schema.

**1. Reaproveitar `bc_core_auditoria` (§7.1, §0.7) fica impossível.** Ela está em
`brasil_saas.brasil_saas` (medido), com FK para `bc_core_empresa` e `bc_core_usuario`.
O banco do Astral não tem nenhuma das duas. O que existe lá é `audit_log`, medido:

```
id bigint | username varchar(80) | entity_type varchar(40) | entity_id varchar(40)
action varchar(40) | diff_json varchar(8192) | timestamp timestamp (sem fuso)
```

E medido também: **0 trigger** e **0 função** no banco do Astral, só a extensão
`plpgsql`. Ou seja, `audit_log` **não serve** como está para a §7.1: falta origem (IP),
falta resultado (sucesso / negação / erro), falta o vínculo com a conexão, e
`diff_json` é `varchar(8192)`, não `jsonb` — 8 KB para guardar SQL e parâmetros é
teto curto, não armazenamento. E sem trigger, a cobertura pelo lado do banco é zero,
então a "auditoria em duas fontes" (§7) vira uma fonte só.

Então o módulo precisa da **sua própria** `dbm.auditoria`. **Isto não é duplicação
entre projetos:** é a consequência normal de um banco por projeto, e cada trilha
pertence a quem responde por aquele banco. O que seria duplicação é o mesmo dado
gravado nos dois lados.

**2. Multiempresa (`empresa_id`) não existe no Astral — e não se aplica.** O banco do
Astral não tem `empresa` nem `usuario` (medido: identidade vem de LDAP/AD e de Postgres,
via `MultiSourceAuthenticationProvider`). O SQL Manager administra **conexões e drivers**,
que não são dado de negócio de empresa. O eixo correto de escopo aqui é
`criado_por` + papel, não `empresa_id`. Isso é uma decisão de segurança e precisa ficar
explícita: o isolamento passa a ser **por usuário e por papel**, e não por empresa.

Consequência no schema: as ocorrências de `empresa_id` saíram do documento inteiro em
29/09 (§6.3, §7.3, §7.5, §12, §14). Em cada tabela o eixo virou `criado_por` +
`papel_id` + `conexao_id`, com FK real. **Esta é a única justificativa para a remoção:**
`empresa_id` sem FK para uma empresa que existe é coluna decorativa, e a tela vai
oferecê-la como filtro.

**3. O schema do Astral não é versionado, e hoje quem o cria é um gerador.** As 16
tabelas vêm de `spring.jpa.hibernate.ddl-auto=update` (medido, `application.properties:19`)
e as entidades são **texto gerado** por `InstallerFirewall.java:506-576`, que escreve
`@Entity public class AuditLog {...}` como string. Não há entidade dessas no
`src/main/java`. O schema do Astral é, literalmente, o que o Hibernate deduziu.

Isto é o incidente 3 de novo, na forma que o dono descreveu: **código que muda sem
documento e sem impacto declarado**, agora dentro do banco.

**4. O risco que precisa de decisão antes de qualquer migration: dois geradores de
schema ao mesmo tempo.** Se Flyway entra no Astral enquanto `ddl-auto=update` estiver
ligado, ou o Flyway recusa um schema não-vazio e nada roda, ou alguém faz *baseline* e
a partir daí o Hibernate **deixa de aplicar mudança de entidade em silêncio** — que é a
mesma falha de rastreabilidade, agora com dois mecanismos brigando pelo mesmo schema.
`spring.jpa.hibernate.ddl-auto` tem que sair de `update` para `validate` **junto** com a
entrada do Flyway, e nunca em momentos diferentes. Isso é conceitual, não
implementacional: é a escolha de quem é dono do schema.

### 0.16 Banco próprio do DBM, e a distinção que precisa ficar explícita

**Decisão do dono (29/09): o DBM tem banco próprio**, `astral_dbm`. Motivo declarado, e
ela é a mesma que motivou a §0.14: isolamento, versionamento, auditoria, deploy
independente, backup independente — e, o motivo que decide: **um Flyway de um projeto
não controla schema de outro.**

```
ERP       →  brasil-saas      (Flyway no ERP, dono: o ERP)
Astral    →  astral           (Flyway no firewall, dono: o astral-firewall)
DBM       →  astral_dbm       (Flyway no DBM, dono: o DBM)
```

E no DBM, desde o primeiro dia: **Flyway é o dono do schema e `ddl-auto=validate`**.
Nunca `update` — nem na primeira versão, nem "só por enquanto". O motivo está medido e
registrado na §0.15: `update` significa que o schema é o que o Hibernate deduziu, e um
schema deduzido não tem histórico, não tem autoria e não tem como ser reconstituído.

#### 0.16.1 Banco do DBM ≠ banco administrado ≠ banco monitorado

Isto precisa estar escrito, porque a leitura errada é óbvia e o erro seria caro: alguém
lê "o DBM tem banco próprio" e conclui que "então o DBM só administra o banco dele".
**É exatamente o contrário.**

O banco `astral_dbm` é o **banco interno do produto** — onde o DBM guarda o que ele
precisa para funcionar. Não é o banco que o DBM administra, e também não é o banco que
o DBM monitora:

| O que vive em `astral_dbm` (interno) | O que vive nos bancos administrados |
|---|---|
| Conexões cadastradas | Tabelas, índices, views, triggers |
| Drivers e catálogo de drivers | Dados de negócio |
| Favoritos, histórico SQL | Metadados do banco alvo |
| Auditoria do DBM | Estatísticas de execução |
| Papéis, RBAC, permissões | Espaço em disco, crescimento |
| Alertas, regras, layouts | Réplicas, lagging |
| Configurações | Integridade, backups |
| Metadados internos, cache | Locks, deadlocks, queries lentas |
| Health Score, ACI, séries de métricas | |

Ou seja: **`astral_dbm` guarda a configuração do produto; os bancos externos são o que o
produto administra.** A analogia é o DBeaver: ele tem banco interno de configuração e
administra centenas de bancos externos ao mesmo tempo.

**Regra, escrita para não ser reinterpretada:**

```
Banco do DBM  ≠  Banco monitorado
Banco do DBM  ≠  Banco administrado
```

Consequência que fecha a questão: mesmo tendo banco próprio, **o DBM continua
JDBC-first e universal**. Conecta em PostgreSQL, Firebird, InterBase, MySQL, MariaDB,
SQL Server, Oracle, SQLite, DB2, SAP HANA, CockroachDB, YugabyteDB, TimescaleDB — ou
qualquer outro que tenha driver. O banco próprio existe para **governança, auditoria,
histórico, RBAC e configuração do produto**. Ele não limita nada do alcance do produto.

Uma consequência operacional que a §0.10 exige registrar: como `astral_dbm` é um banco
novo, ele entra na §0.13 — diretório próprio (`dbm/`), backup próprio, e **certificação
só depois de executar contra ele de verdade** (Nível 3 exige ambiente real).

### 0.17 Camada de inteligência — e o princípio que ela exige para não mentir

O dono definiu (29/09) que o DBM não pode ser "IBExpert web" nem "DBeaver web", porque
isso qualquer um copia. A diferenciação são métricas próprias:

| Indicador | Pergunta que responde |
|---|---|
| **Astral Health Score** (0–100) | Este banco está saudável, em atenção ou crítico? |
| **Astral Query Risk** (0–100) | Esta query é perigosa, antes de eu executar? |
| **Astral Confidence Index** (ACI, %) | Posso confiar neste banco agora? |
| **Índice de Utilidade de Índices** | Qual índice é desperdício? |
| **Previsão de Crescimento** | Qual banco vai lotar primeiro? |
| **Detecção de Anomalias** | O que está explodindo antes de alguém perceber? |

**O princípio que os seis-indicator exigem, e que é a mesma regra já aplicada em §0.9 e
§7: nenhum número aparece sem dizer de onde veio.** Não é formality: é o que separa
"métrica" de "número bonito".

Medido nesta máquina, o problema é concreto, não hipotético:

- **CPU e RAM não são observáveis por JDBC.** O JDBC não tem como ler CPU ou memória do
  servidor do banco. O Health Score não pode ser "portátil" nesses dois fatores: tem de
  dizer de onde vem cada um, e degrade quando não vem de lugar nenhum.
- **Locks, deadlocks e queries lentas dependem de catálogo do fabricante.** No PostgreSQL
  vêm de `pg_locks` e `pg_stat_activity`, e **de `pg_stat_statements` para as lentas** —
  e o `pg_stat_statements` **não está instalado nesta máquina e exige reinício para
  entrar** (medido). Sem ele, "queries lentas" do PostgreSQL é uma quarta parte do
  possível, e a UI precisa dizer isso.
- **Réplica é catálogo de fabricante.** `pg_stat_replication` no PostgreSQL; em outros
  bancos, existe ou não existe, e às vezes exige privilégio que o DBM não tem.
- **Integridade não é JDBC.** `pg_amcheck` e equivalentes são ferramenta do servidor.
- **Backup válido o DBM não consegue ver.** Não existe como saber, por JDBC, se o último
  backup foi testado. Só dá para o DBM registrar o que **ele próprio** verificou — e a
  §15.3 diz que verificação de backup exige staging, que ainda não existe.

Então **todo score é um registro com quatro campos, nunca um número solto:**

```
valor · cobertura · medido_em · fonte
```

E a cobertura é declarada em fator: `ACI 94% (5 de 6 fatores verificados)`. A diferença
entre `ACI 94%` e `ACI 94% · parcial: sem verificação de backup porque não há staging` é
a diferença entre uma ferramenta que informa e uma que decora. **Um score sem
cobertura declarada é mentira com decimal.**

O mesmo vale para os outros cinco: Previsão de Crescimento e Detecção de Anomalias
dependem de série histórica, então **no primeiro dia não há dado** — e a resposta honesta
é "dados insuficientes, preciso de N amostras", não uma projeção inventada a partir de
um ponto. E o Query Risk é **estimativa com base declarada**: ver §16.2 para o que é
sabível antes de executar e o que não é.

### 0.18 Nomenclatura do DBM — `dbm_`, sem `bc_`, sem `empresa_id`

Decisão do dono (29/09), aplicada ao documento inteiro no mesmo dia. Três nomes mudam de
uma vez, e o motivo é o mesmo: o prefixo `bc_` é herança da hipótese — a de que o
produto morava dentro do ERP — que a §0.16 já encerrou.

| Antes | Agora | Por quê |
|---|---|---|
| `bc_dbm_conexao` | `dbm_conexao` | `bc_` = Brasil Cloud. O produto é o *Astral Database Manager*. |
| `bc_dbm_favoritos` | `dbm_favorito` | plural e singular coexistiam (§1 e §14.5) |
| `bc_dbm_metricas_serie` | `dbm_metrica_serie` | o mesmo: as duas formas apareciam em seções diferentes |
| `empresa_id` | `criado_por` + `papel_id` + `conexao_id` | empresa é conceito de ERP (§0.15) |
| `bc_core_auditoria` | `dbm_auditoria` | banco por projeto (§0.16) |
| `bc_core_configuracao` | `dbm_configuracao` | idem |
| `dbm.alLOW_risco` | `dbm.allow_risco` | typo |
| `nomespaced` | `namespaced` | idem |

**`dbm_` e não `astral_dbm_`:** o banco já se chama `astral_dbm` e as tabelas moram
dentro dele. `astral_dbm.astral_dbm_conexao` repete o mesmo nome duas vezes no mesmo
statement. O prefixo `dbm_` é a sigla do produto, que é o que sobrevive mesmo que o
banco mude de lugar um dia.

**O que essa remoção revelou:** não existia **tabela de usuário nem de papel** no
documento, e 49 linhas dependiam de `usuario_id` e `papel`. RBAC especificado (§6.2,
§13.8) e auditoria com "quem" (§7.2) apontavam para uma identidade inexistente — e
remover `empresa_id` tornaria isso definitivo, porque não sobraria nenhum alvo de FK.
Então a §14 ganhou `dbm_usuario` e `dbm_papel` (§14.1). Sem `empresa_id` sobrando, uma
tabela de usuário que não existe deixa de ser herança e passa a ser buraco.

**Correção de 29/09, depois de medir:** o `dbm_usuario` que eu criei aqui nasceu com
`senha_hash`, e `dbm_usuario_papel` nasceu com ele. Os dois foram removidos ou
reduzidos depois de ler a autenticação que o Astral já tem — o dono mandou validar
antes de inventar, e a validação diz que o DBM **não guarda senha nenhuma** e que
papel é fato do AD/Postgres, não linha local. Ver §0.19.

**Cinco defeitos que a renomeação expôs** — nenhum é cosmético:

1. **RBAC sem identidade.** 49 linhas, zero tabelas. Ver acima.
2. **`dbm_historico_query.favorite BOOLEAN` duplicava `dbm_favorito`.** Dois lugares
   para o mesmo fato, e o que valia era a flag — então favoritar não deixava rastro.
   Virou registro: a flag saiu (§14.5).
3. **`dbm_favorito_compartilhado` só existia por causa da empresa.** Ele só existia
   para separar o favorito compartilhado *com a empresa*; sem empresa, "compartilhado"
   é atributo do favorito, não tabela. Saiu (§14.6).
4. **`dbm_mudanca` sem `conexao_id`.** A tabela registra alteração de objeto *de um
   banco administrado*, e sem a conexão não há como saber de qual. Com o DBM
   administrando vários bancos, "a tabela `pedidos` foi alterada" é informação inútil
   — e `astral` e `brasil_saas` têm gente demais com o mesmo nome (§14.16).
5. **Colisão de nome em `dbm_conexao`.** A coluna `usuario` é o login do **banco
   alvo**; `usuario_id` nas outras tabelas é o usuário do **DBM**. Lado a lado em
   toda consulta, é convite a bug. A coluna virou `usuario_bd` (§14.2).

E três consertos de português que estavam no caminho: `escopo (pessoal|global)` virou
`(pessoal|compartilhado)` — "global" significava "global para a empresa", e sem
empresa não significa nada; `papel` virou `papel_id` com FK; e `schema` virou
`schema_nome`, que é como `dbm_mudanca` já chamava a mesma coisa.

**O que continua escrito no documento e é proposital:** `empresa_id` e `bc_core_*`
aparecem ainda, mas só em três papéis — (a) no inventário do ERP (§0.1, fato medido em
`V2__core.sql`), (b) nas decisões que explicitam que foram mortas (§0.7, §0.15, §7.1),
e (c) nas tabelas do §14, dizendo o que cada coluna substituiu. Nenhuma delas é
definição de coluna. **Confirmação mecânica:** `grep` de coluna com `empresa_id` na
lista de campos devolve zero; as 15 ocorrências restantes estão todas em prosa.

### 0.19 Identidade: reutilizar o que o Astral já resolveu, não criar um segundo

> **SUPERADA em 30/09 pela §0.25.** O título e a premissa desta seção foram *"reutilizar
> o que o Astral já resolveu"*. Deixou de ser verdade: o Auth Service é produto
> independente e o DBM é consumidor nativo do contrato, sem passar pela autenticação
> interna do Astral. **O que segue foi medido e continua verdadeiro sobre o Astral** --
> é a leitura de `com.astral.main.security`. O que morreu foi a conclusão de que o DBM
> herda aquilo. Texto antigo preservado, sem reescrita, para a citação continuar auditável.


O dono mandou (29/09) validar a autenticação do Astral **antes** de inventar modelo de
usuário, sessão ou RBAC para o DBM. Validei lendo o código, e o resultado muda o §14.1
que eu tinha escrito no mesmo dia. Registrado aqui porque a correção é de substance,
não de redação.

#### 0.19.1 O que o Astral já resolve, medido

Quatro arquivos, 262 linhas, em `com.astral.main.security`. Nada disso precisa ser
reimplementado:

| Peça | Onde | O que é |
|---|---|---|
| Fontes de identidade | `MultiSourceAuthenticationProvider.java` | AD (LDAP/UnboundID) e role do Postgres |
| Regra de distinção | `:36-40` | "fonte não conhece o usuário" → `null`, tenta a próxima; "senha errada" ou "fonte fora" → **lança**, não cai para a próxima |
| Papéis | `:96-116` | `memberOf` contém grupo admin → `ROLE_ASTRAL_ADMIN`; `pg_has_role(current_user,'astral_admin','USAGE')` → idem |
| Identidade em runtime | `AstralPrincipal.java` | 11 linhas: username + source + authorities. Sem id, sem e-mail, sem perfil |
| Sessão | `SecurityConfig.java:16-17` | `HttpSession`, `HttpSessionSecurityContextRepository`, `IF_REQUIRED`, `changeSessionId()` no login |
| Contrato | `LoginController.java:39-43` | `/api/auth/me` → `{authenticated, username, authorities}` |
> **A linha do contrato acima está SUPERADA (§0.25).** O contrato oficial é o do Auth
> Service: `{identityId, username, provider, groups}`. O `/api/auth/me` foi o contrato do
> Astral e **não é contrato alternativo a ser mantido** -- fica citado aqui para a
> rastreabilidade da citação, e o DBM não o consome mais. As demais linhas da tabela
> descrevem código do Astral que segue existindo, e continuam registradas como medição do
> Astral, não como dependência do DBM.

Duas coisas dessa tabela merecem ser ditas com destaque, porque são a mesma disciplina
que o resto do documento cobra:

- **Não há tabela de usuário, por decisão, não por esquecimento.** O `astral` tem 16
  tabelas e nenhuma de usuário. A identidade é externa.
- **Não há JWT, nem OAuth, em lugar nenhum do Astral.** A sessão é `HttpSession`. E o
  `fabric/firewall` **não tem autenticação própria** (0 ocorrências de
  `SecurityFilterChain`, `AuthenticationProvider`, `Principal` ou `GrantedAuthority` no
  módulo inteiro): herda.

A regra de distinção em `:36-40` merece nota porque o bug que ela corrige é
exatamente o tipo que passa despercebido: antes, cada fonte envolvia tudo em
`catch(Exception ignored)`, então senha errada no AD levantava `LDAPException`, o
`ignored` engolia, e a autenticação caía no Postgres — que valida usuário e senha do
próprio banco. **Um role do Postgres com o mesmo nome de uma conta do AD entrava com a
senha do Postgres, sem passar pelo AD.** A exceção declarada é o *result code* 49 do
Samba AD, que responde igual para "não existe" e "senha errada" (para não enumerar
usuário) e por isso cai para o Postgres: trade-off aceito pelo dono contra o bypass de
*shadow role*, que exigiria já ser admin do banco.

#### 0.19.2 O que isso corrige no que eu tinha escrito

**Eu escrevi `dbm_usuario` com `senha_hash` (bcrypt ou argon2) no §14.1, e estava
errado.** Isso é um segundo store de credenciais dentro do mesmo ecossistema — dois
sistemas de identidade para produtos do mesmo dono, que é o que a decisão existe para
impedir. Não é um detalhe de modelagem: é a coisa que a §0.19 proíbe.

Também escrevi `dbm_usuario_papel`, e isso estava errado por outro motivo: **papel é
fato do AD ou do Postgres.** Uma tabela onde alguém inserisse `usuario_id`/`papel_id`
seria um lugar que a autenticação nunca lê, e cujo dono acharia que estava concedendo
acesso. Tabela de permissão que ninguém consulta é tabela que mente.

O §14.1 foi reescrito: `dbm_usuario` virou **perfil e preferência** (chaveado pelo
username do token, sem hash), `dbm_papel` virou **catálogo dos papéis conhecidos** (para
a UI e para o mapeamento em `dbm_permissao`, sem conceder nada), e
`dbm_usuario_papel` **não existe**.

#### 0.19.3 O que "reutilizar" cobra, e é a única coisa que sobra

Aqui está o custo real, e ele é de infraestrutura, não de código.

**A sessão do Astral vive na heap do processo.** `HttpSessionSecurityContextRepository`,
`IF_REQUIRED`, e **sem `spring-session` e sem Redis no `pom.xml`** (medido: 0
ocorrências de `spring-session`, `data-redis` ou `redis`). Traduzido: um cookie de
sessão emitido pelo Astral é **sem sentido para qualquer outro processo** — o DBM é
outro processo, em outra porta.

Então reutilizar a sessão exige `spring-session-data-redis` no DBM **e no Astral**. E
Redis já está no stack do DBM (§13.6), o que torna isso barato do lado do DBM.

**Mas isso muda o comportamento do Astral, e por isso não é decisão minha:** com a
sessão na heap, reiniciar o Astral desloga todo mundo; com a sessão no Redis, deixa de
deslogar. É mudança de runtime do Astral, que é área da MUSE, e o dono tem de escolher
consciente. **Não implementei nada disso** — registrei porque "reutilizar" não é de
grátis, e quem tem de saber o preço antes de dizer "reutilizar".

Pergunta enviada à MUSE em `ia-hub/canais/astral-PARA-muse.md` para conferir a leitura
acima. Ela está `CALADA ttl=-2` (medido, `ia-hub who`), então não houve resposta — e a
resposta acima vem do código, que é mais confiável que a lembrança de quem escreveu.
### 0.20 Falha de fonte não é ausência de dado

O dono mandou (29/09) transformar o achado do *shadow role* em lição arquitetural do DBM, e
não em nota de bug. A lição é mais larga que autenticação, e vale para todo valor que o DBM
mostra.

**A regra:** *fonte que falhou é resultado diferente de fonte que não tem o dado.* Um produto
que mostra os dois como "nada" está mentindo com a ausência — e, quando a segunda fonte é uma
fonte mais permissiva, a ausência deixa de ser ausência e vira porta.

#### 0.20.1 A instância de segurança, que é a que quase sobreviveu

No `MultiSourceAuthenticationProvider` do Astral cada fonte envolvia tudo em
`catch(Exception ignored)`. Senha errada no AD levantava `LDAPException`, o `ignored`
engolia, e a autenticação caía na fonte seguinte: o Postgres, que valida usuário e senha do
próprio banco.

```
AD falha  ->  Exception ignorada  ->  cai para o Postgres  ->  autentica por outra fonte
```

**Um role do Postgres com o mesmo nome de uma conta do AD entrava com a senha do Postgres, sem
passar pelo AD.** A transição não era um canto do código: era o comportamento padrão de
qualquer falha de rede no AD, ou seja, exatamente quando o AD importa mais, porque é quando
ele cai.

Corrigido em `MultiSourceAuthenticationProvider:36-40`: "esta fonte não conhece este usuário"
devolve `null` e tenta a próxima; "senha errada" ou "fonte fora do ar" **lança** e não cai. A
única exceção é o *result code* 49 do Samba AD, que responde igual para "não existe" e "senha
errada" e por isso cai para o Postgres: trade-off aceito pelo dono contra o bypass de *shadow
role*, que exigiria já ser admin do banco.

**Três condições, e as três importam.** A falha de fonte é sinalizada e nunca absorvida. A
transição é **explícita**: exceção nomeada, com o motivo. E é **previsível**, para quem lê o
código saber de antemão em que condição acontece. Sem as três, a mesma linha de código vira
quatro comportamentos em quatro dias de infraestrutura.

#### 0.20.2 A mesma forma, no DBM, em seis lugares

O DBM mede bancos que não controla. Em cada um deles a falha silenciosa tem a forma errada, e
**todas as seis já estavam cobertas por regras soltas deste documento, nenhuma com o nome que
as unifica**:

| Fonte | Se falhar e virar silêncio | O que o DBM tem que dizer | Onde já está |
|---|---|---|---|
| Identidade (AD/Postgres) | senha errada no AD autentica no Postgres | `503` fonte indisponível é diferente de `401` credencial inválida | §0.19.1 |
| Métrica ausente | `pg_stat_statements` não instalado lido como "nenhuma query lenta" | cobertura `1 de 5` declarada, nunca zero | §0.17, §16.1 |
| Integridade | verificação indisponível lida como "íntegro" | fator como **teto**, sai como limite inferior | §16.3 |
| Backup | backup não verificado lido como "backup ok" | fator como **piso**, sai como limite superior | §15.3 |
| Replicação | réplica inalcançável lida como "sem lag" | `fonte indisponível` no eixo do lag, não lag vazio | §0.16.1 |
| Driver | download falho lido como "driver incompatível" | erro de *fetch*, não de compatibilidade | §0.11 |

Nenhuma delas é exótica. São a mesma linha de código com nome diferente, e por isso valem uma
regra só.

#### 0.20.3 Consequência de schema: a regra não pode morar na convenção

Aplicar a regra ao DBM expôs um buraco que já estava lá, do mesmo tipo do buraco que o
`senha_hash` representava. **§0.17 exige que todo score seja um registro com quatro campos
(`valor · cobertura · medido_em · fonte`), e o documento não tinha tabela de score.**
`dbm_score`, `dbm_health`, `dbm_aci`, `dbm_indice`, `dbm_risco`, `dbm_anomalia`,
`dbm_previsao`: **zero ocorrências no documento inteiro**, enquanto §0.16.1 afirma que "Health
Score, ACI" vivem em `astral_dbm`. A regra dos quatro campos era contrato sem schema, a mesma
forma do "RBAC existia, mas usuário não existia".

E o mesmo buraco aparece meio passo atrás: `dbm_metrica_serie` (14.15) era `id, conexao_id,
metrica, bucket_ts, valor, host, regiao`. Tem `valor` e **nenhum** dos outros três. `bucket_ts`
não é `medido_em`, porque é a janela agregada e não o instante da coleta; e `fonte`
simplesmente não existia, numa tabela que existe justamente para guardar série de métrica.

Corrigido nesta rodada:

- **`dbm_score` (14.21)**: os seis indicadores em uma tabela, com `valor`, `cobertura`,
  `medido_em` e `fonte` como **colunas**, não como convenção de escrita.
- **`dbm_metrica_serie` e `dbm_metrica_agregado` (14.15)**: `fonte` e `medido_em`
  acrescentados, `fonte NOT NULL`.

`NOT NULL` é o ponto, e vale mais que a coluna. A regra proíbe que falha de fonte vire
ausência; então a ausência **não pode ser representada** em `fonte`. Quando a fonte não
responde, o valor gravado é `indisponivel`, que é um dado e é auditável. `NULL` ali seria a
regra funcionando só no papel, com o buraco exatamente onde a regra promete fechar.

**E a transição tem de ser auditável**, como o dono exigiu: é por isso que `fonte` é coluna e
não nota. A pergunta "isto foi medido ou foi suposto?" precisa de resposta em `SELECT`, e não
na memória de quem rodou a coleta.

**Decisão do dono, 29/09: documentar sim, implementar não.** O `spring-session-data-redis`
fica registrado como opção futura e **não entra em código agora**, até existir alinhamento
entre a MUSE (que é a área) e o dono. O motivo do adiamento não é técnico, Redis já
está no stack do DBM (13.6) e o custo do lado do DBM é baixo. É de escopo: mudar onde vive
o estado de sessão do Astral é runtime do Astral, e uma peça não mexe no runtime da outra.
Revisitar quando a MUSE responder `astral-PARA-muse.md` (MSG 001 e 002) e o dono confirmar o
efeito em produção.

### 0.21 Tabela sem tela é funcionalidade sem interface — regra do dono (29/09)

O dono pediu, depois de a Space Bunny passar o dia achando no ERP que
"Controller existe, Service existe, Migration existe, Tela não existe" e
"funcionalidade existe, ninguém sabia": **enquanto se modela, pensar também em quem
consome.**

**A regra:** toda tabela importante do DBM declara o caminho

```
Tabela  ->  Service  ->  API  ->  Tela
```

ou, no mínimo, `Tabela -> consumidor planejado`. A pergunta não é "falta tabela?",
é "**falta tela?**" — e a segunda é a que estava caindo.

O motivo não é aesthetics. Função sem interface é o que produz duas consequências
caras: ninguém descobre que existe, e ela custa manutenção sem entregar valor. É
por isso que a regra é sobre **descoberta**, e não sobre completude.

#### 0.21.1 Aplicar a regra no que já estava escrito encontrou cinco furos

Rodei o caminho de cada uma das 27 tabelas da §14 contra a §1 (menus) e a §8
(monitoramento). O resultado:

| Tabela | Tela declarada antes | Veredito |
|---|---|---|
| `dbm_usuario`, `dbm_papel`, `dbm_permissao`, `dbm_permissao_escopo`, `dbm_execucao_permitida` | **nenhuma** | **furo** |
| `dbm_score` (os seis indicadores) | **nenhuma** | **furo** |
| `dbm_sessao`, `dbm_sessao_historico` | **nenhuma** | **furo** |
| `dbm_configuracao` | "Configurações do módulo", sem chave mapeada | furo |
| `dbm_historico_query`, `dbm_favorito`, `dbm_snippet` | só o painel do editor (§3.1) | declarado por acidente |

**O primeiro furo é o mais caro, e é uma armadilha de leitura.** A §1 tem um bloco
chamado `Segurança` com `Papéis`, `Usuários`, `Permissões` e `Sessões`. Quem lê a
§1 conclui que o RBAC do DBM tem tela. **Não tem.** Esse bloco administra as roles
do **Postgres que se administra** — o que a §1 ele próprio denuncia ao listar os
atributos `LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS`, que
são de role do Postgres, e a §12.1 ao dizer "Nível 2: Bancos / Schemas / Papéis /
Usuários". São 27 telas que não são a tela do DBM, com o nome parecido.

Isso é a mesma classe de erro do "RBAC existia, mas usuário não existia", invertida:
agora a tela existe, o nome bate, e o conteúdo é de outro banco. Quem procurar a
tela de `dbm_usuario` vai parar em `CREATE ROLE` no banco alvo.

**O segundo furo é o que o dono previu.** §8.3 lista 10 painéis, e **todos os 10 são
métrica de infraestrutura** (CPU, load, memória, conexões, QPS, p95, locks, cache,
I/O, réplica, storage, jobs). **Nenhum dos seis indicadores aparece em painel
nenhum.** `dbm_score` existia, e o Health Score não tinha onde ser mostrado — que é
literalmente o exemplo que o senhor deu.

Corrigido nesta rodada: a §1 ganhou `Segurança do DBM` e `Inteligência`, a §8.3
declara que indicador não é painel, e o mapa abaixo é o contrato.

#### 0.21.2 O mapa: 27 tabelas, 27 consumidores

Um mapa só, aqui, e não uma coluna espalhada em 27 subseções — mapa é contrato e
fica em um lugar que se lê inteiro. Telas `própria` têm entrada de menu; telas
`embutida` são painel dentro de outra, e isso é declarado de propósito, não por
esquecimento.

| Tabela | Service | API | Tela | Fluxo de uso |
|---|---|---|---|
|---|---|---|---|---|
| `dbm_conexao` | `conexao` | `/api/dbm/conexoes` | **própria** Conexões (8 itens, §1) | Conexões → "Nova conexão" no formulário → POST /api/dbm/conexoes → ConexaoService.criar → dbm_conexao → retorno: a conexão entra na lista, com o estado do último teste ao lado do nome<br>Conexões → "Editar" numa conexão → PUT /api/dbm/conexoes/{id} → ConexaoService.atualizar → dbm_conexao → retorno: a ficha fecha e a lista passa a mostrar a versão nova<br>Conexões → "Excluir" → DELETE /api/dbm/conexoes/{id} → ConexaoService.excluir → dbm_conexao → retorno: some da lista; se há trilha, o RESTRICT recusa e a UI diz por quê |
| `dbm_grupo_conexao` | `conexao` | `/api/dbm/conexoes/grupos` | **própria** Conexões > Agrupar | Conexões > Agrupar → arrastar a conexão para uma pasta nova → POST /api/dbm/conexoes/grupos → GrupoConexaoService.criar → dbm_grupo_conexao → retorno: a pasta aparece na árvore lateral com a conexão dentro |
| `dbm_sessao` | `conexao` | `/api/dbm/conexoes/{id}/sessao` | **embutida** Editar/Testar conexão | Editar/Testar conexão → "Testar conexão" → POST /api/dbm/conexoes/{id}/sessao → SessaoWorkbenchService.abrir → dbm_sessao (Redis) → retorno: banner de sessão, com transação e botão Encerrar<br>Editar/Testar conexão → "Encerrar" → DELETE /api/dbm/conexoes/{id}/sessao → SessaoWorkbenchService.fechar → dbm_sessao (Redis) → retorno: o banner some e a conexão volta a ficar ociosa |
| `dbm_historico_query` | `editor` | `/api/dbm/historico` | **embutida** painel do editor (§3.1) | painel do editor → "Executar" (F5) → POST /api/dbm/query → EditorService.executar → dbm_historico_query → retorno: a linha entra no painel Histórico com duração e status<br>painel do editor → abrir o Histórico → GET /api/dbm/historico → HistoricoQueryService.listar → dbm_historico_query → retorno: histórico da conexão, do mais recente para trás |
| `dbm_favorito` | `editor` | `/api/dbm/favoritos` | **embutida** painel do editor (§3.1) | painel do editor → estrela no SQL selecionado → POST /api/dbm/favoritos → FavoritoService.criar → dbm_favorito → retorno: o SQL vira item do painel Favoritos, e favoritar agora deixa rastro<br>painel do editor → "Favoritos" → GET /api/dbm/favoritos → FavoritoService.listar → dbm_favorito → retorno: a lista separa pessoal de compartilhado, porque o escopo é do próprio favorito |
| `dbm_snippet` | `editor` | `/api/dbm/snippets` | **embutida** painel do editor (§3.1) | painel do editor → "Novo snippet" → POST /api/dbm/snippets → SnippetService.criar → dbm_snippet → retorno: o snippet aparece na lista para reuso<br>painel do editor → "Snippets" → GET /api/dbm/snippets → SnippetService.listar → dbm_snippet → retorno: a lista mostra descrição e escopo de cada snippet |
| `dbm_usuario` | `rbac` | `/api/dbm/usuarios/eu` | **própria** Meu perfil | Meu perfil → abrir a tela → GET /api/dbm/usuarios/eu → UsuarioService.meuPerfil → dbm_usuario → retorno: nome, fonte, preferências e último acesso<br>Meu perfil → "Salvar preferências" → PUT /api/dbm/usuarios/eu/preferencias → UsuarioService.salvarPreferencias → dbm_usuario → retorno: as preferências voltam aplicadas na próxima tela<br>automático: primeiro acesso autenticado → AuthInterceptorService.registrar → dbm_usuario → retorno: nenhum; a linha nasce do token válido, sem clique nenhum |
| `dbm_papel` | `rbac` | `/api/dbm/papeis` | **própria** Papéis do DBM (leitura) | Papéis do DBM → abrir a lista → GET /api/dbm/papeis → PapelService.listar → dbm_papel → retorno: o catálogo de papéis com a origem, e sem botão de criar |
| `dbm_permissao` | `rbac` | `/api/dbm/papeis/{id}/permissoes` | **própria** Matriz de permissões | Matriz de permissões → marcar a permissão do papel → PUT /api/dbm/papeis/{id}/permissoes → PermissaoService.associar → dbm_permissao → retorno: a célula da matriz muda para concedido, e a gravação na auditoria<br>Matriz de permissões → abrir a aba Permissões → GET /api/dbm/papeis/{id}/permissoes → PermissaoService.listar → dbm_permissao → retorno: a matriz mostra o que cada papel tem |
| `dbm_permissao_escopo` | `rbac` | `/api/dbm/permissoes/escopo` | **embutida** Matriz de permissões | Matriz de permissões → "Escopo" numa permissão → PUT /api/dbm/permissoes/escopo → PermissaoEscopoService.recortar → dbm_permissao_escopo → retorno: a linha de recorte entra abaixo da permissão, e no papel Operador vira GRANT no banco alvo |
| `dbm_execucao_permitida` | `rbac` | `/api/dbm/papeis/{id}/execucoes` | **embutida** Matriz de permissões | Matriz de permissões → aba "Execuções" → PUT /api/dbm/papeis/{id}/execucoes → ExecucaoPermitidaService.liberar → dbm_execucao_permitida → retorno: a função entra na lista; lista vazia é o estado correto de leitura, e a tela diz isso<br>Matriz de permissões → aba "Execuções" → GET /api/dbm/papeis/{id}/execucoes → ExecucaoPermitidaService.listar → dbm_execucao_permitida → retorno: as funções liberadas por papel, ou "nenhuma liberada" |
| `dbm_auditoria` | `auditoria` | `/api/dbm/auditoria` | **própria** Auditoria > Trilha | automático: qualquer ação gravada, antes de responder ao cliente → AuditoriaService.registrar → dbm_auditoria → retorno: nenhum na hora; a linha aparece na Trilha com antes/depois<br>Auditoria > Trilha → filtrar e abrir um registro → GET /api/dbm/auditoria → AuditoriaService.listar → dbm_auditoria → retorno: a trilha paginada, com selo de cobertura parcial enquanto o event trigger não estiver instalado |
| `dbm_execucao` | `auditoria` | `/api/dbm/auditoria/execucoes` | **embutida** Auditoria > Trilha | automático: SQL executado no editor → AuditoriaSqlService.registrar → dbm_execucao → retorno: nenhum na hora; a execução entra na trilha com norm_sql e sql_hash<br>Auditoria > Trilha → aba SQL → GET /api/dbm/auditoria/execucoes → AuditoriaSqlService.listar → dbm_execucao → retorno: execuções com sql_hash, duração e linhas afetadas<br>Auditoria > Trilha → "Top consultas" → GET /api/dbm/auditoria/execucoes/top → TopSqlService.agrupar → dbm_execucao → retorno: o ranking agrupa por norm_sql, e não por texto |
| `dbm_negativa` | `auditoria` | `/api/dbm/auditoria/negativas` | **própria** Auditoria > Tentativas negadas | automático: negação da 6.7, rodando também em leitura → NegativaService.registrar → dbm_negativa → retorno: a tentativa entra na lista com motivo estruturado e a regra que negou<br>Auditoria > Tentativas negadas → filtrar por usuário ou IP → GET /api/dbm/auditoria/negativas → NegativaService.listar → dbm_negativa → retorno: as negações do período, agrupáveis por regra |
| `dbm_mudanca` | `auditoria` | `/api/dbm/auditoria/ddl` | **própria** Auditoria > DDL do banco | automático: event trigger ddl_command_end no banco alvo → EventoDdlService.registrar → dbm_mudanca → retorno: o DDL entra na lista com comando e sessão; sem o trigger, a tela avisa que a cobertura é parcial<br>Auditoria > DDL do banco → abrir o detalhe → GET /api/dbm/auditoria/ddl → MudancaService.listar → dbm_mudanca → retorno: o histórico de DDL do banco alvo |
| `dbm_sessao_historico` | `auditoria` | `/api/dbm/auditoria/sessoes` | **própria** Auditoria > Sessões do DBM | automático: abertura e fechamento de sessão de workbench → SessaoHistoricoService.registrar → dbm_sessao_historico → retorno: a linha fica com sql_count e transacao_aberta<br>Auditoria > Sessões do DBM → procurar sessão em aberto → GET /api/dbm/auditoria/sessoes → SessaoHistoricoService.listar → dbm_sessao_historico → retorno: quem ficou com transação aberta, e há quanto tempo |
| `dbm_metrica_serie` | `monitoramento` | `/api/dbm/metricas/serie` | **própria** Monitoramento > Métricas históricas | automático: coleta a cada N minutos, com a fonte declarada → MetricaService.coletar → dbm_metrica_serie → retorno: nenhum na hora; a série aparece no gráfico com a fonte rotulada<br>Monitoramento > Métricas históricas → escolher série e janela → GET /api/dbm/metricas/serie → MetricaService.listar → dbm_metrica_serie → retorno: a série temporal, com a lacuna marcada quando a fonte faltou, em vez de interpolada |
| `dbm_metrica_agregado` | `monitoramento` | `/api/dbm/metricas/agregado` | **embutida** Monitoramento > Métricas históricas | automático: agregação por hora ou por dia → MetricaService.agregar → dbm_metrica_agregado → retorno: o gráfico muda de granularidade sem recalcular no navegador<br>Monitoramento > Métricas históricas → "Agregar" → GET /api/dbm/metricas/agregado → MetricaService.consultarAgregado → dbm_metrica_agregado → retorno: o agregado do período |
| `dbm_alerta_regra` | `monitoramento` | `/api/dbm/alertas/regras` | **própria** Monitoramento > Alertas | Monitoramento > Alertas → "Nova regra" → POST /api/dbm/alertas/regras → AlertaRegraService.criar → dbm_alerta_regra → retorno: a regra entra na lista com limiar e severidade<br>Monitoramento > Alertas → abrir a aba Regras → GET /api/dbm/alertas/regras → AlertaRegraService.listar → dbm_alerta_regra → retorno: as regras cadastradas |
| `dbm_alerta_evento` | `monitoramento` | `/api/dbm/alertas/eventos` | **embutida** Monitoramento > Alertas | automático: regra disparada na avaliação → AlertaService.disparar → dbm_alerta_evento → retorno: o evento entra na aba Eventos, com regra, conexão e medido_em<br>Monitoramento > Alertas → aba Eventos → GET /api/dbm/alertas/eventos → AlertaService.listarEventos → dbm_alerta_evento → retorno: os eventos disparados no período |
| `dbm_job` | `monitoramento` | `/api/dbm/jobs` | **embutida** Monitoramento > Painéis (Jobs) | automático: backup, coleta ou agregação agendados → JobService.agendar → dbm_job → retorno: o painel mostra a execução como pendente, rodando ou falhada, com o erro<br>Monitoramento > Painéis → aba Jobs → GET /api/dbm/jobs → JobService.listar → dbm_job → retorno: o histórico de jobs com duração e erro |
| `dbm_score` | `inteligencia` | `/api/dbm/score` | **própria** Inteligência (5 telas) | automático: avaliação periódica, e só entra em ranking com cobertura completa → ScoreService.calcular → dbm_score → retorno: nenhum na hora; o score aparece no painel com a cobertura declarada<br>Inteligência → abrir um score → GET /api/dbm/score → ScoreService.consultar → dbm_score → retorno: nota, tipo, fonte e medido_em, e nunca um número sem procedência |
| `dbm_backup` | `backup` | `/api/dbm/backups` | **própria** Backup e Restore (5 itens) | Backup e Restore → "Backup agora" → POST /api/dbm/backups → BackupService.executar → dbm_backup → retorno: a entrada entra na lista com tamanho e checksum conferido<br>Backup e Restore → "Restaurar" → POST /api/dbm/backups/{id}/restaurar → RestoreService.executar → dbm_backup → retorno: a restauração passa por staging e verificação antes de gravar no destino |
| `dbm_driver` | `driver` | `/api/dbm/drivers` | **própria** Drivers (6 itens) | Drivers → "Baixar driver" → POST /api/dbm/drivers → DriverService.baixar → dbm_driver → retorno: a linha nasce com checksum conferido, data de download e o nível de suporte que a máquina mediu<br>Drivers → abrir a lista → GET /api/dbm/drivers → DriverService.listar → dbm_driver → retorno: o catálogo, sem prometer "certificado" para o que só é compatível |
| `dbm_configuracao` | `configuracao` | `/api/dbm/configuracoes` | **própria** Configurações do módulo | Configurações do módulo → editar o valor → PUT /api/dbm/configuracoes/{chave} → ConfiguracaoService.atualizar → dbm_configuracao → retorno: o valor muda, e a tela dona da chave passa a usar o novo<br>Configurações do módulo → abrir → GET /api/dbm/configuracoes → ConfiguracaoService.listar → dbm_configuracao → retorno: as chaves, cada uma com a tela dona ao lado |
| `dbm_migration` | `enterprise` | `/api/dbm/migrations` | **própria** Enterprise > Migrações | Enterprise > Migrações → "Gerar diff" → POST /api/dbm/migrations/diff → MigracaoService.gerarDiff → dbm_migration → retorno: o diff aparece, e nada é aplicado ainda<br>Enterprise > Migrações → "Aplicar" numa pendência → POST /api/dbm/migrations/{id}/aplicar → MigracaoService.aplicar → dbm_migration → retorno: o estado vira aplicada, ou falhada com o erro de verdade<br>Enterprise > Migrações → abrir a lista → GET /api/dbm/migrations → MigracaoService.listar → dbm_migration → retorno: a fila com o estado de cada versão (pendente, aplicada, falhada, revertida), que é a lista que o menu promete e o §11.3 descreve |
| `dbm_aprovacao` | `enterprise` | `/api/dbm/aprovacoes` | **própria** Enterprise > Aprovações | Enterprise > Aprovações → "Aprovar" ou "Recusar" → POST /api/dbm/aprovacoes/{id}/decisao → AprovacaoService.decidir → dbm_aprovacao → retorno: a decisão fica registrada com quem decidiu e quando<br>Enterprise > Aprovações → abrir a fila → GET /api/dbm/aprovacoes → AprovacaoService.listar → dbm_aprovacao → retorno: a fila do que está esperando decisão |

**As cinco telas de Inteligência e o que cada uma mostra**, porque é nelas que os
quatro campos do §0.17 aparecem na interface:

| Tela | Índice | Onde aparece cobertura, fonte e medido_em |
|---|---|---|
| **Saúde** | Health Score e ACI | selo sob o número: `94% (5 de 6 fatores)`, `fonte: pg_catalog`, `medido há 2 min` |
| **Analisador de Query** | Query Risk | fatores com `fonte` por fator, e o carimbo "estimativa, não é permissão" (§6.7) |
| **Utilidade de Índices** | Índice de Utilidade de Índices | janela de 30 dias e a data do reset, ao lado de `uso 0` |
| **Previsão de Crescimento** | Previsão | número de amostras, e "dados insuficientes" antes do mínimo |
| **Anomalias** | Detecção de Anomalias | `fonte` da série, e o badge `indisponivel` quando a coleta falhou |

E o badge `indisponivel` (`fonte NOT NULL`, §0.20.3) **aparece nas cinco**, com a
fonte que falhou. É o requisito do §0.20 chegando na tela: o usuário vê a
indisponibilidade, não um zero.

#### 0.21.3 O prefixo `/api/dbm`, e por que ele é decisão e não convenção

O documento **não tinha camada de API** até aqui: zero endpoint do DBM, e as
únicas menções a `/api/` eram o contrato herdado `/api/auth/me` (§0.19) e o
envelope `ApiResponse` do `shared/dto/` do ERP (§1 linha 25 da lista de
convenções). O serviço já tem regra de negócio e permissão fina (§12.1, e
`@PreAuthorize` no método do service, não só no controller), mas o contrato HTTP
não existia.

Decisão: **todo endpoint do DBM nasce sob `/api/dbm/`**, e devolve `ApiResponse`,
que é o envelope que o resto do sistema já usa. O prefixo não é estética: o Astral
são **dois processos** (8080/8081 e 8040) e o DBM pode ser servido por qualquer um
deles. Sem prefixo próprio, a mesma rota significantemente diferente em processos
diferentes, e a §0.19.3 já deixou registrado que a sessão compartilhada entre eles
é uma decisão em aberto. Prefixo próprio deixa o contrato independente de qual
processo serve a rota.

#### 0.21.4 O que a regra não cobre, e eu não vou fingir que cobre

- **Implementação de tela** está fora desta rodada, e o senhor aceitou: o caminho é
  pensado, o código vem depois. O que não pode é o caminho faltar.
- **Índice, view e função** do banco alvo não são tabelas do `astral_dbm` e não
  entram no mapa; eles são administrados pelo navegador de Objetos (§1).
- **A regra é verificável, e é requisito permanente desde 29/09** (§0.22.1): toda
  tabela declarada na §14 tem que aparecer no mapa da §0.21.2 **com consumidor, API,
  tela prevista e fluxo de uso**. Se amanhã nascer `dbm_algo` sem linha no mapa, o
  documento está errado e a checagem acusa. Tabela incompleta nesse caminho é **erro
  arquitetural**, não dívida.

#### 0.21.5 O que a coluna de fluxo encontrou

A coluna de fluxo só passou a existir porque o senhor apontou que ela é o elo que ninguém
verifica. Ela já pagou: o mapa tinha 4 colunas, e as 4 eram insuficientes. Os achados:

**1. Uma tabela tem mais de um fluxo, e a coluna de API não dava conta.** `dbm_historico_query`
tem API dona `/api/dbm/historico`, que é a **leitura**; quem **escreve** é a execução do SQL, em
`POST /api/dbm/query`, que não estava no mapa. Uma coluna só não cabe uma tabela que se lê e se
grava por caminhos diferentes. O mapa ganhou a 5ª coluna, e a API da coluna 3 passou a ser lida
como **API dona** — a principal, não o conjunto.

**2. Duas APIs do mapa não tinham consumidor nenhum.** A regra exige identidade de endpoint, e
não semelhança de texto, porque `/api/dbm/auditoria/outro` contém `/api/dbm/auditoria` como
substring e a linha passaria a prometer uma API que ninguém usa:

| Tabela | API dona declarada | O que a regra encontrou | Correção |
|---|---|---|---|
| `dbm_usuario` | `/api/dbm/usuarios` | nenhum fluxo chama a coleção; só existem `/usuarios/eu` e `/usuarios/eu/preferencias`. Não há tela de gestão de usuários, e não deve haver | dona corrigida para `/api/dbm/usuarios/eu` |
| `dbm_migration` | `/api/dbm/migrations` | nenhum fluxo chamava a coleção, embora o menu prometa o nó **Migrações** e o §11.3 liste os estados pendente/aplicada/falhada/revertida | fluxo de lista acrescentado |

A correção de `dbm_usuario` é também uma decisão de segurança. `GET /api/dbm/usuarios` seria
**enumerar identidades de todas as fontes** a partir do DBM. Não há tela que precise
disso, e a tela é a justificativa de uma API. Sem tela, sem endpoint. O argumento ficou
mais forte com a §0.25: as fontes passaram a viver no Auth Service, e listar provedores a
partir do DBM seria um segundo catálogo de identidade dentro do consumidor — que é
exatamente a forma que a decisão proíbe.

**3. Onze das 27 tabelas se escrevem sozinhas** — 11 fluxos `automático:`, com gatilho declarado
(coletor, agendador, interceptor, event trigger). A primeira versão da regra exigia endpoint em
todo fluxo, e estava errada: escrita automática não é disparada por clique, e exigir endpoint
obrigaria a inventar um. A regra que ficou é mais forte que a que eu tinha escrito: fluxo
automático declara gatilho, e **tabela cujos fluxos são todos automáticos é tabela que ninguém
vigia** — ela aceita escrita e não há caminho de leitura para descobrir que parou de escrever.

**4. O verificador é artefato versionado**, em `docs/dbm/verifica_mapa.py`, e é o que transforma a
§0.22.1 de frase em checagem. Ele acusa, não corrige: quem corrige sozinho é regra que ninguém lê.
Medido agora: **27 tabelas, 54 fluxos, 11 automáticos, 0 sem caminho.**

O mapa é a 5ª coluna e o verificador é o procedimento. Se o mapa ganha tabela sem fluxo, o
verificador acusa; se o verificador é alterado para passar, a alteração está no diff.

### 0.22 Governo do DBM: o que passa a ser requisito permanente

Três decisões do dono em 29/09, e elas não são preferência de redação: são regra que muda o
que "pronto" significa.

#### 0.22.1 Requisito permanente: caminho completo, e quebrá-lo é erro de arquitetura

O senhor fixou a checagem de 27/27 como requisito permanente e definiu o critério de
falha: **tabela nova sem consumidor, sem API, sem tela prevista e sem fluxo de uso é erro
arquitetural** — não é dívida.

Isso fecha o ciclo que a §0.21 abriu:

```
Dados -> Regra -> API -> Consumidor -> Tela
```

E o "fluxo de uso" é o quinto elo porque é o único que ninguém checa. Sabendo quem consome,
qual API responde e qual tela mostra, ainda pode faltar o caminho que liga os três: o
clique que chama a API que grava a tabela. Tabela sem fluxo é schema órfão com teste
unitário em volta.

**O que continua valendo da §0.21.4:** implementação de tela está fora do escopo atual, e
o que não pode é o **caminho** faltar.

#### 0.22.2 A fronteira de segurança: banco alvo contra DBM, mantida explícita

Decisão do dono, mantida como regra e não como preferência de menu. Misturar a segurança
do banco **administrado** com a segurança **interna do DBM** gera confusão tanto para
quem implementa quanto para quem usa — e a confusão já aconteceu: o bloco `Segurança` da
§1 parecia cobrir o RBAC do DBM e na verdade administrava roles do Postgres alvo
(§0.21.1).

Regra: **toda tela e toda tabela de segurança declara de qual dos dois lados está, e o
nome da tela diz.** Isso vale para menu, rota de API, tabela e permissão — não só para o
menu, porque a API é onde a confusão custa incidente.

| | Segurança do banco alvo | Segurança do DBM |
|---|---|---|
| Onde vive | no Postgres que se administra | no `astral_dbm` (§14.18) |
| Quem concede papel | `CREATE ROLE` e `GRANT` no alvo | ninguém: papel é fato da fonte de identidade (§0.19.2) |
| Telas | `Segurança do banco alvo` (§1) | `Segurança do DBM` (§1) |
| Rotas | `/api/dbm/seguranca/alvo/**` | `/api/dbm/rbac/**` |

**Uma lacuna nesta seção, e ela é do lado do DBM.** A tabela acima declara tela, rota, tabela
e permissão dos dois lados. O que ela **não** declara é o **modelo de privilégio do banco
`astral_dbm`**: quem é o dono do banco, qual identidade a aplicação possui contra ele, e o que
um acesso direto ao banco consegue fazer. Medido na V100: **0 `CREATE ROLE`, 0
`GRANT`/`REVOKE`, 0 RLS, 0 `OWNER TO`**, e nada que responda a essas três perguntas. A §0.7
decide roles **do banco alvo**, nunca do banco do DBM — e a distinção importa, porque as duas
respostas não se substituem.

**Registrado como risco arquitetural identificado, sem proposta.** Não há modelo, role, tabela
nem migration para isto, e nada será decidido antes das decisões maiores. A pergunta a
responder não é "quem aplica a migration", e sim **"qual identidade a aplicação deve possuir
no banco do DBM"** — a resposta muda o modelo inteiro, inclusive se a mesma credencial pode
alterar a própria auditoria. Ela depende de decisões que ainda estão abertas: destino canônico
do DBM, direção do produto, autenticação compartilhada entre ERP, Astral e DBM, e a
possibilidade de migração para SQL Server.

#### 0.22.3 Autenticação é dependência em evolução, e o DBM só consome o contrato

O senhor avisou que a MUSE está fechando a autenticação do Astral com validação por
**Active Directory, Linux e banco/PostgreSQL**, e mandou não gastar tempo refinando login.
Aceito — e com uma consequência concreta que a regra da §0.20.3 impõe.

**O que o DBM consome, e é tudo (alterado em 30/09, §0.25):** o contrato oficial do
Auth Service, `{identityId, username, provider, groups}` (§0.25), e nada mais. A versão
anterior desta frase nomeava `/api/auth/me` -> `{authenticated, username, authorities}`
(§0.19.1) e a sessão do Astral com `changeSessionId()`: **as duas saíram**, porque
dependem de Auth dentro do Astral. A sessão do DBM passa a ser a do Auth Service, e o
contrato passa a ser o único contrato.

**O que o DBM nunca faz:** guardar senha, validar senha, conceder papel, construir login.
A única superfície de autoridade do DBM é o mapeamento em `dbm_permissao` (§14.18), e
autoridade fora do catálogo de `dbm_papel` não concede nada (§14.1).

**A consequência que quase passei:** escrevi `dbm_usuario.source (AD|POSTGRES)` como se
fosse enum fechado. Com a validação por **Linux** entrando no modelo da MUSE, esse `CHECK`
passa a rejeitar um login legítimo — e o sintoma seria o usuário existir na fonte e não
ter perfil no DBM, que é um furo de segurança silencioso e do pior tipo.

Então `source` segue a mesma regra de `fonte` (§0.20.3): **`TEXT` com vocabulário
documentado**, não `CHECK` de dois valores. Vocabulário hoje: `AD`, `POSTGRES`, `LINUX`.
Fonte nova entra sem migration; ausência não entra, porque a linha só nasce depois de um
token válido, e token válido já é identidade.

Quando a MUSE consolidar o modelo, o encaixe é neste parágrafo e em `dbm_usuario`. Nada
mais do DBM muda, porque o contrato é o mesmo nos dois casos.

#### 0.22.4 Onde a V100 roda, e por que o caminho óbvio está errado

**Medido agora, no repositório:**

| Onde | Flyway | Banco que migra |
|---|---|---|
| `pom.xml` raiz, app 8080/8081 | **não tem** (0 ocorrências) | — |
| `fabric/firewall`, app 8040 | `enabled=true`, `locations=classpath:db/migration`, `baseline-version=1` | **`astral`** |

O único Flyway do Astral inteiro é o do firewall, e a datasource dele é
`jdbc:postgresql://127.0.0.1:5432/astral`. O app principal aponta para `astral` com
`ddl-auto=none` e sem Flyway no classpath.

**Logo, `V100__dbm_inicial.sql` não pode ir em
`fabric/firewall/src/main/resources/db/migration/`.** Se for, o Flyway do firewall executa
a V100 contra **`astral`** e cria as tabelas do DBM dentro do banco do Astral — que é
exatamente o erro que a diretriz de um banco por projeto (§0.14) proíbe, e a forma mais
concreta possível de "um Flyway de um projeto controlar o schema de outro".

E o DBM não tem módulo nenhum ainda: procurar `dbm` no repositório devolve **0 caminhos**.

**Onde a V100 vai, então.** Ela é SQL puro, e SQL não depende de onde roda. A V100 é
escrita e versionada junto da especificação, em `docs/dbm/`, e o lugar de execução é
decidido à parte, porque essa decisão é de processo e não de SQL. As três saídas, com o
custo de cada uma:

| Saída | Custo |
|---|---|
| **A** — módulo `fabric/dbm` dentro do Astral, app próprio, datasource `astral_dbm`, porta 8083 | **REJEITADA pelo dono em 29/09**. Eu recomendei A porque `fabric/firewall` já é esse padrão no repositório, e a convenção manda. O senhor recusou pelo motivo certo: o problema não era o caminho da migration, era o DBM morar dentro do projeto que ele administra |
| **B** — segundo Flyway dentro de um app existente, com `DataSource` separado | Duas datasources num app só, e `ddl-auto=validate` passa a validar dois schemas com regras diferentes. Funciona, e é onde a confusão volta |
| **C** — aplicar a V100 por `flyway`/CLI, sem Spring e sem módulo | Entrega o schema e **nada do DBM rodando** |

**Decisão do dono em 29/09, e ela muda o rumo, não o detalhe:** a V100 **não roda no
Astral**. Nem `astral` e `astral_dbm` dividindo Flyway, nem o Firewall criando tabela do
DBM. A direção passa a ser a de produto independente:

```
astral_dbm  =  repositório próprio  =  aplicação própria  =  banco próprio  =  Flyway próprio
```

E a consequência de operar assim: **a execução fica em aberto até a estrutura do novo
repositório estar preparada.** Não forçar encaixe no repositório atual, e não criar módulo
provisório "enquanto não se decide" — módulo provisório vira permanente, e o primeiro que
usa é o que dita a arquitetura.

Isto vale para o DBM inteiro, e não só para a migration. Um produto que é componente de
outro herda o ritmo, o banco, o deploy e a autenticação do outro. O senhor tem razão em
que o DBM já não se comporta como módulo, e a direção de projeto acompanha isso.

**O que não muda:** a V100 é SQL puro, não depende de onde roda, e fica versionada com a
especificação até o repositório existir. Se um dia ela precisar mudar de casa, o conteúdo
não muda — só o `git mv`.
### 0.23 Nomenclatura: o que está marcado para revisão

Reunido aqui num lugar só, porque decisão de nome espalhada por 2.900 linhas é decisão de
nome que se perde. **Nenhuma delas foi aplicada** — todas aguardam o dono.

| # | Onde | Hoje | Candidatos | Por quê |
|---|---|---|---|---|
| 1 | §0.18, §14 | `dbm_` | — | prefixo curto e legível; `astral_dbm_` duplica o nome do banco |
| 2 | §14 | schema `public` | — | sem `CREATE SCHEMA dbm`: uma camada a menos para errar |
| 3 | §14.2 | `usuario_bd` | — | é o login do **banco alvo**; ao lado de `criado_por` (usuário do DBM), o par `usuario`/`usuario_bd` em toda consulta é convite a bug |
| 4 | §14.6, §14.7 | `escopo (pessoal\|compartilhado)` | — | atributo do registro, não tabela |
| 5 | §13.8 | `ROLE_ADMIN` fora | — | nome que o ERP já usa para outra coisa |
| 6 | §11, §1, mapa §0.21.2 | **"Recursos Enterprise"** | **Operação** ou **Deploy** | `Enterprise` convive com a §6.3, que diz que não existe multiempresa no DBM. Quem lê vai procurar `empresa_id`, e o trabalho de removê-lo foi longo. diff, migrações, deploy e aprovação descrevem melhor a finalidade real |

O #6 é o único com preferência já declarada pelo dono em 29/09, e é o único que ainda
estava espalhado por três seções sem marcação. Aplicar o nome é uma linha em cada uma
delas, e fica para quando o nome estiver fechado — renomear duas vezes é pior do que
renomear uma.

### 0.24 Dependência sem consumidor declarado não entra no DBM

Regra do dono (29/09), permanente, na mesma forma da §0.22.1. Uma dependência que ninguém
consome é custo sem contrapartida, e no banco do DBM o custo é privilegiado: extensão executa
código arbitrário, e é por isso que a §6.7 a recusa.

**A instância medida — e ela é minha.** A V100 carregava
`CREATE EXTENSION IF NOT EXISTS pgcrypto` desde a primeira versão. Medido: **0 chamadas** de
função de pgcrypto em SQL executável (`digest`, `hmac`, `gen_salt`, `pgp_sym_encrypt`,
`pgp_sym_decrypt`, `crypt`) e **12 chamadas** a `gen_random_uuid()` — que é função de núcleo
desde o PostgreSQL 13, cuja release note diz que *"previously UUID generation functions were
only available in the external modules uuid-ossp and pgcrypto"*. A extensão foi instalada
pela função que não precisava dela. Isso causou um incidente: uma verificação de privilégio
com `CREATE EXTENSION` entrou no `public` do banco do Astral, sem autorização, em 29/09.

**Ele não participa da autenticação, e isso é informação de fora.** A autenticação do Astral
está em AD + SSL, PostgreSQL por SCRAM-SHA-256 nativo, Linux por PAM, e cert/peer quando
aplicável (informado pela IA 2, 29/09). SCRAM resolve a autenticação do PostgreSQL sem
pgcrypto, e o DBM não tem senha de login própria (§0.19). Ou seja: **pgcrypto não é
dependência de autenticação em lugar nenhum** — o que o torna candidato à remoção é só a
medição de 0 consumidores, e não um ganho de segurança em autenticar.

**O que a spec nunca decidiu, e que a V100 comprou sem perguntar.** §6.9 e §14.2 diziam "senha
criptografada com pgcrypto" sem dizer se a cifra acontecia no SQL (`pgp_sym_encrypt`) ou no
processo Java. Sem pgcrypto não há cifra dentro do banco, então a cifra é da aplicação: chave
em variável de ambiente, escrita em `senha_cifrada BYTEA`. O **algoritmo não está decidido** e
não é inventado agora; o que a medição elimina é o caminho via extensão, não a
obrigação de cifrar.

**Estado da remoção: candidata, pendente, não commitada.** Decisão do dono em 29/09:

| | |
|---|---|
| Identificado como | dependência sem consumidor (medido) |
| Situação | **candidato à remoção** |
| Na cópia de trabalho da V100 | linha removida, **não commitada** |
| Revalidação | **pendente**, e não é feita agora |
| Onde a revalidação vai ocorrer | no ambiente definitivo de `astral_dbm`, **nunca no Astral** |

**Por que a remoção não vira commit.** A V100 foi validada estruturalmente com 706 linhas,
**com** a extensão. Depois da validação a linha saiu, e a versão alterada **não foi
revalidada** — a suíte de verificação depende de conexão ao banco, hoje indisponível. O dono
preferiu registrar um rótulo honesto a correr uma validação por baixo. Então a V100 da cópia de
trabalho está marcada, em §13.10, como **alterada após validação**. DDL equivalente não é migration
validada: é o mesmo SQL com uma linha a menos, em um arquivo que ninguém rodou.

**Consequência se a necessidade voltar.** Criptografia dentro do banco não está proibida; está
*não declarada*. Se surgir consumidor real, entra como migration própria, com número,
consumidor, justificativa e impacto — nunca como linha silenciosa na primeira migration.

**O erro de raciocínio, nomeado.** A §8.6 justificava `pgcrypto` e `uuid-ossp` com "já estão
em uso no ERP (medido nas migrações)". Extensão em PostgreSQL é **por banco**: o uso em
`brasil_saas` não diz nada sobre o banco de um cliente nem sobre `astral_dbm`. É a mesma
forma da concatenação firewall/Astral/ERP que eu próprio cometi — tomar o que é verdade num
projeto e estender para outro. Fato medido em um lugar não é medida em outro.


### 0.25 O Auth Service e' produto independente, e o DBM e' consumidor nativo do contrato

> **DECISAO FECHADA pelo dono em 30/09.** Registrada aqui e aplicada no resto do documento
> nesta mesma rodada. **Nenhuma linha de SQL, migration, codigo ou ambiente foi tocada**:
> `astral_dbm` ainda tem 0 arquivos Java.

O Auth Service **nao faz parte do Astral**. Ele e' produto independente, com repo proprio
(`brasil-saas-auth`), versionamento, deploy, systemd, portas proprias (8100/8101) e
OpenAPI proprios. **ERP, Astral, DBM e Proxy sao apenas consumidores** do contrato de
identidade. Para o DBM a consequencia e' mais forte que nas outras tres, porque o DBM
nasce agora: ele e' **consumidor nativo do contrato desde o inicio**, e nao integracao,
nem adapter, nem heranca do Astral.

**Contrato oficial, unico, sem alternativa:**

```
{
  "identityId": "...",
  "username": "...",
  "provider": "...",
  "groups": [...]
}
```

**O que o DBM consome:** esses quatro campos, e nada mais. **O que o DBM nunca faz:**
validar senha, guardar senha, conceder papel, construir login, ou perguntar a uma fonte
qualquer por conta propria.

Consequencias que chegam neste documento:

1. **Nenhuma dependencia arquitetural de "Auth dentro do Astral".** As §0.19, §0.19.1 e
   §0.19.3 mediram a autenticacao interna do Astral como coisa que o DBM reutilizaria. Isso
   **morreu**: a medicao continua verdadeira *sobre o Astral*, mas o DBM nao a consome
   mais. O texto antigo esta marcado como superado, com a citacao preservada.
2. **Sem modulos de identidade internos ao DBM.** Nada de
   `MultiSourceAuthenticationProvider`, `Principal`, `GrantedAuthority` ou filtro de login
   proprio.
3. **Sem duplicar providers AD/Postgres/Linux/Cert no consumidor.** Essa lista vive no
   Auth Service. O DBM consome o campo `provider`; nao o implementa.
4. **Sem contrato alternativo.** As duas ocorrencias de `/api/auth/me` neste documento
   (§0.19.1 e §0.22.3) viram registro de citacao superada. Mantê-las como contrato vivo
   seria um segundo contrato -- e a decisao proibe segundo contrato.

**Legacy e novo fluxo convivem, e a virada nao e' do DBM.** O legado continua atras de
`auth.mode=legacy`; o fluxo novo e' `auth.mode=ad`. O DBM consome o contrato nos dois
casos, porque o contrato e' o mesmo -- o que muda e' quem resolve a identidade, e isso nao
e' do DBM. `auth.mode` e' chave do Auth Service, e o DBM nao escreve nela.

**O que continua aberto, e por que esta decisao nao respondeu.** A §0.22.2 pergunta **qual
identidade a aplicacao deve possuir no banco do DBM**. A resposta aqui e' sobre o
*usuario*: de onde vem a identidade dele. O *modelo de privilegio do banco `astral_dbm`* --
owner, role, grant, credencial de servico -- e' outra pergunta, de outra camada, e
**continua sem decisao**. Misturar as duas e' o erro que a §0.20.2 documenta, e por isso a
pergunta continua escrita como pergunta. Medido na V100: 0 `CREATE ROLE`, 0 `GRANT`,
0 `REVOKE`, 0 RLS, 0 `OWNER TO`.

**Medido na implementacao, 30/09** (leitura, sem alterar): existe em
`/home/euripedes/brasil-saas-auth` o registro `IdentityDto`, que casa com o contrato
acima -- `UUID identityId`, `String username`, `String provider`, `Set<String> groups`. O
`provider` vem declarado com valores `AD`, `LINUX`, `POSTGRES`, `CERTIFICADO`, e a porta
8100 esta livre na maquina. Tres pontos que registro sem resolver, porque nao sao meus:

- **O `provider` do contrato tem um valor a mais do que a spec documentava.** A §14.1
  documentava `source` com `AD`, `POSTGRES`, `LINUX`; o contrato traz tambem
  `CERTIFICADO`. Isso **nao** obriga mudanca de schema: `source` ja e' `TEXT` e nao
  `CHECK` -- que foi a decisao certa quando foi tomada, e por isso o quarto valor entrou
  sem migration nenhuma. O que muda e' que a lista da §14.1 deixa de ser vocabulario que
  o DBM inventou e passa a ser **espelho do contrato do Auth Service**.
- **`brasil-saas-auth` ainda nao e' repositorio git** (medido: `git rev-parse` falha no
  diretorio, que tem `pom.xml`, `src` e `target/`). A decisao diz "repo proprio"; o repo
  ainda nao existe. Nao inicializo: e' outro produto e nao foi pedido.
- **O `AdProvider.java` tem um byte NUL cru no offset 3986**, dentro de um metodo que
  escapa parenteses e NUL para filtro LDAP, e o `file` o classifica como `data`, nao
  `texto`. Nao toquei. Registro porque o DBM vai consumir esse contrato, e um fonte Java
  que nao e' texto e' o tipo de coisa que falha em build de outra maquina.

Nenhum dos tres bloqueia o DBM. Os tres sao do Auth Service.
## 1. Estrutura completa de menus

Árvore de menus, na ordem em que aparecem. O nível de detalhe é o contrato: cada item é uma
entrada navegável real, não um rótulo.

```
Database Manager
├── Conexões
│   ├── Lista de conexões                    (todas as visíveis ao usuário)
│   ├── Nova conexão
│   ├── Editar conexão
│   ├── Testar conexão
│   ├── Conectar / Desconectar
│   ├── Duplicar conexão
│   ├── Exportar conexão (.json sem senha)
│   ├── Importar conexão
│   └── Agrupar (pastas por ambiente: prod/homolog/dev)
│
├── Bancos
│   ├── Lista de bancos do servidor
│   ├── Criar banco
│   ├── Alterar banco
│   ├── Renomear banco
│   ├── Drop banco                          (exige papel + confirmação digitada)
│   ├── Clonar banco                        (§4.3)
│   ├── Tamanho em disco
│   └── Propriedades
│
├── Schemas
│   ├── Lista de schemas
│   ├── Criar schema
│   ├── Alterar schema
│   ├── Drop schema
│   └── Permissões por schema                (§6.5)
│
├── Objetos                                  (§9 — o coração do módulo)
│   ├── Tabelas
│   │   ├── Lista
│   │   ├── Colunas
│   │   ├── Restrições (PK, FK, UNIQUE, CHECK)
│   │   ├── Índices
│   │   ├── Triggers
│   │   ├── Regras (RLS)
│   │   ├── Comentários
│   │   ├── Estatísticas
│   │   └── Ações: ver DDL, editar no designer, exportar, dropar
│   ├── Views
│   │   ├── Lista
│   │   ├── Colunas da view
│   │   ├── Dependências (o que usa, o que é usado)
│   │   └── Ações: ver definição, editar, criar, dropar
│   ├── Funções
│   │   ├── Lista
│   │   ├── Assinatura e corpo
│   │   ├── Dependências
│   │   └── Ações: criar, editar, dropar
│   ├── Procedures
│   │   └── (mesma estrutura de Funções)
│   ├── Triggers
│   │   ├── Lista
│   │   ├── Evento (BEFORE/AFTER/INSTEAD OF, INSERT/UPDATE/DELETE/TRUNCATE)
│   │   ├── Tabela alvo
│   │   ├── Condição WHEN
│   │   └── Ações: criar, editar, desabilitar, dropar
│   ├── Sequências
│   │   └── Lista, valor atual, criar, alterar, dropar, resetar
│   ├── Domínios
│   │   └── Lista, definição, criar, dropar
│   ├── Tipos
│   │   └── ENUM, COMPOSITE, DOMAIN: criar, alterar, dropar
│   ├── Extensões
│   │   └── Lista, instalar, atualizar, remover
│   └── Índices (visão consolidada de todos os índices do banco)
│
├── Segurança do banco alvo       (§5 — roles, usuários, permissões e sessões do
│                                Postgres que se administra, não do DBM)
│   ├── Papéis (roles)
│   │   ├── Lista
│   │   ├── Papéis do sistema (sempre desabilitados para edição)
│   │   ├── Membros do papel
│   │   ├── Papéis que este papel contém
│   │   └── Criar, alterar, dropar
│   ├── Usuários
│   │   ├── Lista
│   │   ├── Atributos (LOGIN, SUPERUSER, CREATEDB, CREATEROLE, REPLICATION, BYPASSRLS)
│   │   ├── Senha (definir/alterar/vencer)
│   │   ├── Quota
│   │   └── Criar, alterar, dropar
│   ├── Permissões
│   │   ├── GRANT por objeto              (§6.4)
│   │   ├── Privilégios do banco
│   │   └── Eficácia de privilégios       (§6.8)
│   └── Sessões
│       ├── whoami
│       ├── Lista de conexões ativas
│       └── Encerrar sessão (terminate)
│
├── Segurança do DBM              (§0.21 — identidade e permissão do próprio produto)
│   ├── Meu perfil                 (dbm_usuario: preferências, layout, último acesso)
│   ├── Papéis do DBM              (dbm_papel: catálogo, somente leitura — §14.1)
│   ├── Matriz de permissões       (§6.2, §14.18 — papel -> permissão dbm.*)
│   └── Sessões do DBM             (dbm_sessao, dbm_sessao_historico)
│
├── Ferramentas DBA                           (§5)
│   ├── Sessões e bloqueios
│   ├── Wait events
│   ├── Top queries
│   ├── Explain / Execution plan
│   ├── Vacuum / Analyze
│   ├── Integridade
│   ├── Reparo
│   ├── Shrink / espaço
│   ├── Configuração e parâmetros
│   ├── Extensões e módulos
│   └── Logs e arquivos
│
├── Backup e Restore
│   ├── Backups (lista, com metadados e integridade)
│   ├── Fazer backup
│   ├── Restaurar
│   ├── Clonar
│   └── Schedules de backup
│
├── Réplica
│   ├── Visão de réplicas
│   ├── Slots de replicação
│   ├── Configuração
│   └── Lag e atraso
│
├── Auditoria                               (§7)
│   ├── Trilha (filtros, antes/depois, exportação)
│   ├── DDL do banco (capturado por event trigger)
│   ├── Tentativas negadas
│   └── Retenção e política
│
├── Monitoramento                            (§8)
│   ├── Painéis
│   ├── Alertas
│   └── Métricas históricas
│
├── Inteligência                   (§0.21, §16 — os seis indicadores; **não** são
│                                painéis de métrica, §8.3)
│   ├── Saúde                      (Health Score + ACI, com cobertura e fonte)
│   ├── Analisador de Query        (Query Risk: fatores e origem do cálculo)
│   ├── Utilidade de Índices        (janela e reset ao lado de "uso 0")
│   ├── Previsão de Crescimento    (nº de amostras; "dados insuficientes" antes)
│   └── Anomalias                  (badge `indisponivel` quando a coleta falhou)
│
├──(versionamento) → Ver "Recursos Enterprise" (§11)
│   ├── Schema diff
│   ├── Comparar dados
│   ├── Migrações
│   ├── Deploy
│   └── Aprovações
├── Drivers                           (§0.5 — Driver Manager)
│   ├── Catálogo de drivers
│   ├── Driver instalado (ativar/desativar)
│   ├── Baixar driver
│   ├── Verificar checksum
│   ├── Atualizar driver
│   └── Cache local
│
└──
    └── (nível raiz) Configurações do módulo, Ajuda
```

---

## 2. Modelo de navegação

### 2.1 Explorer lateral

Árvore de três níveis, recolhível, com **filtro incremental** no topo que filtra por nome em
qualquer nível sem consultar o banco (a árvore já está em memória).

- Nível 1: Conexões (e pastas de ambiente)
- Nível 2: Bancos / Schemas / Papéis / Usuários
- Nível 3: Tipo de objeto (Tabelas, Views, ...)
- Nível 4: Objetos

Comportamento exigido:

- Clique simples = seleciona e **não** abre conexão. Árvore populada sob demanda por conexão.
- Duplo clique em conexão = conectar e popular a árvore.
- Ícone por tipo de objeto e por estado: tabela comum, tabela materializada, tabela particionada,
  objeto desabilitado, objeto sem permissão.
- Contador por tipo, para o usuário saber o tamanho sem abrir.
- Botão direito = menu de contexto específico do objeto (§12.3).

### 2.2 Abas de trabalho

Cada aba é uma **sessão de workbench** com `id` estável. A aba guarda: conexão, banco/schema,
modo (leitura/escrita/DDL), transação aberta, e histórico de execução da aba.

Ao fechar a aba com transação aberta: **perguntar** — confirmar e descartar, ou manter a
sessão aberta em segundo plano com TTL (§2.4).

### 2.3 Múltiplas conexões simultâneas

- Pool por conexão registrada, no máximo N conexões físicas por servidor (padrão 3, configurável).
- Ao atingir o teto: a conexão fica em espera com mensagem explícita, não trava a UI.
- Conexões são **reentrantes**: abrir a mesma conexão em duas abas é permitido e usa a mesma
  sessão física, para que transação aberta seja visível nas duas.
- Fim de ociosidade (`idle_timeout`) fecha a sessão do servidor e marca a aba como reconectando.

### 2.4 Session management do workbench

O workbench sobrevive a F5 e a fechar o navegador. Implementação:

- Estado da sessão (abas, conexão, transação, última consulta) em **Redis**, chave
  `dbm:wb:<usuario>:<sessao>`, com TTL (padrão 2h).
- Ao recarregar, a UI pede o estado; abas voltam; a transação é **verificada antes de
  ser declarada viva** — se a conexão física caiu, a aba volta em estado `reconectado` com
  aviso, nunca fingindo que a transação continua.
- Nunca devolver credencial de conexão no estado da sessão: só o `conexao_id`.

### 2.5 Histórico, favoritos e recentes

- **Histórico**: `dbm_historico_query`, com `conexao_id`, `sql_text`, `sql_hash`,
  `executado_em`, `usuario_id`, `duracao_ms`, `status`. Reexecuação com um clique, com aviso
  de que DDL/DML vai pedir confirmação de novo.
- **Favoritos**: `dbm_favorito`, com nome, SQL e opcionalmente conexão de origem.
- **Recentes**: por usuário, última lista, ordenável por uso, sem auditar conteúdo — só metadado.

---

## 3. Editor SQL

### 3.1 Layout

Grade de três regiões:

```
┌─────────────────────────────────────────────────────────────┐
│ barra: conexão · banco · modo [Leitura|Escrita|DDL] · salvar  │
├──────────────┬──────────────────────────┬───────────────────┤
│ histórico /  │  editor (monaco)         │  resultado        │
│ favoritos /  │                          │                   │
│ snippets     │                          │  (grid/texto/     │
│              │                          │   explain/plan)   │
├──────────────┴──────────────────────────┴───────────────────┤
│ status: linhas · duração · transação [Aberta|Commit|Rollback]│
└─────────────────────────────────────────────────────────────┘
```

Divisor arrastável, os três painéis podem ser ocultados, e o estado de layout persiste por
usuário. Split view: horizontal e vertical, ambos com editor e resultado independentes mas
compartilhando o mesmo contexto de conexão/transação.

### 3.2 Syntax highlight e dialecto

- Monaco Editor com tokenizer por dialecto. O dialecto vem da conexão: `PostgreSQL`, `MySQL`,
  `Firebird/InterBase`.
- Tema segue o padrão do ERP. Fonte monoespaçada, `Ctrl+/` comenta bloco.
- Realce de erro de sintaxe por parse leve no cliente, e o **erro real** vem do servidor.

### 3.3 Autocomplete e Intellisense

Duas fontes, ambas do servidor, com cache por conexão (Redis, TTL 10min, invalidado quando o
catálogo muda):

1. **Palavras-chave do dialecto** — estático por SGBD, servido do backend.
2. **Objetos do catálogo** — tabelas, colunas com tipo, views, funções, procedimentos, papéis.
   Inclui colunas resolvendo `*` da tabela base, para `SELECT * FROM` completar a lista.

Comportamento exigido:

- `Ctrl+Espaço` completa; `Ctrl+Shift+Espaço` mostra a documentação do item.
- Aceita tabela com aspas ou sem, resolve as duas formas.
- Precedência por contexto: dentro de `FROM` oferece tabelas; dentro de `JOIN ON` oferece
  colunas; dentro de `GRANT` oferece papéis; dentro de `CREATE TABLE` oferece tipos do dialecto.
- Não consulta o banco a cada tecla: só no foco e no `Ctrl+Espaço`.

### 3.4 Snippets, macros e templates

- **Snippets** por usuário e globais, com placeholder `${tabela}`, `${coluna}`, `${esquema}`
  que expandem ao_tabular.
- **Macros**: sequência de comandos com atalho, executada em ordem; se um comando falhar, para
  e reporta em qual parou.
- **Templates**: SQL de criação por tipo de objeto, versionado junto com o código.
- **Bookmarks**: marcadores nomeados dentro do editor, com lista e navegação.

### 3.5 Execução

- `Ctrl+Enter` executa a seleção ou o statement sob o cursor.
- **Vários statements**: identificar os statements separados por `;`, respeitando
  `$$`/`$tag$` (funções), strings e comentários. Sem isso, executar um corpo de função cortado
  no meio do texto é a forma mais rápida de gerar erro bobo.
- Cada statement mostra: duração, linhas afetadas ou retornadas, e o erro com posição.
- **Cancelamento**: botão que emite cancelamento no servidor (§3.8), não um timeout de cliente.

### 3.6 Execution plan

- `EXPLAIN` e `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` (Postgres), equivalentes nos outros.
- O plano vem em JSON e é renderizado como árvore com nós clicáveis, custo estimado por nó,
  tempo real quando `ANALYZE` foi usado.
- Botão "explicar usando node" e "usando índice" quando o planner escolheu diferente do esperado.
- Plano com `ANALYZE` **executa a query**: exige o mesmo caminho de confirmação de DDL/DML.

### 3.7 Resultado e exportação

- Grid com paginação no servidor (`OFFSET`/`cursor`), ordenação e filtro no cliente sem
  reprocessar tudo.
- Alternar grid / texto / JSON / CSV.
- Coluna com valor muito longo: truncar na exibição, botão para abrir o valor completo.
- Exportação para CSV, JSON, XLSX e inserção SQL (`INSERT INTO ... VALUES`), com limite de
  linhas e execução da exportação como job (§13.4) quando for grande.

### 3.8 Cancelamento e limites

- `Statement.cancel()` na JDBC, exposto por cancelamento assíncrono.
- `statement_timeout` por sessão, configurável (padrão 30s para leitura, sem default para DDL).
- Teto de linhas (padrão 50.000) aplicado no servidor: ao estourar, a consulta é cancelada e
  o usuário recebe "resultado truncado", não um `OutOfMemory` no frontend.
- **Teto de tempo total de transação aberta** (padrão 1h): fecha e faz rollback com aviso.

---

## 4. Administração de banco

### 4.1 Criar / alterar / dropar

- Criar: nome, dono, codificação, locale, collation, tamanho inicial, tablespace, autorização.
  Preview do SQL e confirmação digitando o nome do banco.
- Alterar: owner, codificação, limites de conexão, tempo de espera de ociosidade, caminho de
  tabela, limites de disco. Cada item vira um `ALTER DATABASE` próprio, com diff antes/depois.
- Dropar: exige papel `dbm.drop_database` (§6), confirmação digitando o nome, verificação de
  conexões ativas, e **backup verificado recente obrigatório** — o botão pergunta, não recusa.

### 4.2 Regras de escrita por operação

| Operação | Transação | Confirmação | Auditoria |
|---|---|---|---|
| `CREATE`/`ALTER`/`DROP` de schema/tabela/view | Sim | Digitada + diff do SQL | DDL via event trigger |
| `INSERT`/`UPDATE`/`DELETE` | Sim | Diff de linhas afetadas | Execução registrada |
| `TRUNCATE` | Sim | Digitada + contagem | Execução + DDL |
| `DROP DATABASE` | Não aplicável | Digitada + backup + papel | Auditoria nível crítico |
| `VACUUM`, `ANALYZE`, `REINDEX` | Fora de transação | Um clique | Execução registrada |

`TRUNCATE` e `DROP` são operações diferentes em risco e emundo na UI: confirmação mais pesada,
cor diferente, e nunca agrupadas com as demais.

### 4.3 Clonar banco

Cópia template, sem parar o original:

1. `CREATE DATABASE alvo TEMPLATE origem` exige conexões ativas no original. O módulo lista as
   conexões e oferece encerrá-las (§5.1), com aviso.
2. Alternativa sem downtime: `pg_dump`/`pg_restore` via job (§13.4), com barra de progresso.
3. O clone entra na lista de conexões como `origem (clone 29/09 07:00)`.

### 4.4 Backup e Restore

- **Fazer backup**: destino (arquivo local, volume montado, ou `S3` compatível), formato
  (`custom`, `tar`, `plain`), nível (full, schema, data), jobs paralelos, compressão, e
  checksum. **O módulo verifica o arquivo gerado** ao final — backup não verificado não entra
  na lista como válido (§7.5).
- **Restaurar**: mostra metadata do backup (tamanho, quando, quem fez, checksum) antes de
  qualquer escrita; gera banco novo por padrão, **nunca** sobrescreve o banco atual sem
  confirmação digitada.
- **Agenda**: `jobs` com cron, histórico de execução, alerta de falha, retenção automática
  (mantém N últimos + tudo do último mês).

### 4.5 Espaço e estatísticas

- **Vacuum/Analyze**: por tabela, com `VACUUM (VERBOSE, ANALYZE)`. Resultado em log, não em
  modal. Alerta se a tabela estiver muito bloated.
- **Shrink**: recomprimir. Operação lenta e bloqueante em alguns casos: exige aviso explícito,
  janela de execução opcional ("agendar para 02:00") e logging do progresso.
- **Estatísticas**: última execução de analyze, número de execuções de autovacuum, tamanho real vs. total,
  número de linhas vivo vs. morto, fragmentação. Tabela consolidada de todas as tabelas, ordenável
  por bloat — é a tela que o DBA abre de manhã.

### 4.6 Integridade, reparo, recuperação

- **Verificação de integridade**: FK órfã, índice sem entrada correspondente, registro com valor inválido
  para check, sequência dessincronizada da coluna default. Cada achado com SQL de correção.
- **Reparo**: gera o SQL de correção, mostra o que vai mudar, e **não executa sozinho**.
- **Recuperação**:diagnostics de corruption (pg_class, pg_index inconsistentes), com o que
  é possível fazer e o que exige restaurar backup. Honestidade aqui vale mais que prometer.

---

## 5. Ferramentas DBA

### 5.1 Sessões, locks e bloqueios

- `pg_stat_activity`: pid, usuário, aplicação, endereço, estado (`active`/`idle`/`idle in
  transaction`), query, início, espera, query ativa.
- **Árvore de bloqueio**: cada sessão bloqueada com o caminho até quem a segura. Clicar num nó
  mostra a query que segura o lock e quem é o-blocking PID. Esta é a tela que resolve 90% dos
  incidentes de "banco travado".
- **Encerrar sessão**: `pg_terminate_backend`, com aviso de que transação ativa faz rollback.
- **Matar todas as sessões do usuário**: ação em lote, exige confirmação e registra na auditoria.

### 5.2 Wait events

`pg_stat_activity.wait_event_type` e `wait_event`, com dicionário amigável em português
(`Lock` → "esperando lock", `IO` → "esperando disco", `LWLock` → "lock interno leve",
`Client` → "esperando o cliente"). Filtro por tipo e por sessão.

### 5.3 Top queries

Exige `pg_stat_statements` (§8.6). Colunas: chamadas, tempo total, tempo médio, pior tempo,
% de tempo I/O, rows por chamada, cache hit. Ordenável por qualquer métrica, com drill para as
sessões que rodaram a query. Cache por 60s, para não virar carga.

### 5.4 Desempenho

- Wait events agregadas por classe.
- Cache hit ratio por tabela e geral.
- Throughput: commits/rollbacks por segundo, leituras/gravações.
- Blocos lidos por segundo, awaits.
- Crescimento de armazenamento por banco e por tabela.
- Tudo com comparação com a hora anterior e com ontem, e sparkline.

### 5.5 Configuração e parâmetros

`pg_settings` com valor atual, valor de origem (`configuration file`, `command line`, `default`),
unidade e contexto (`superuser-backend`, `backend`, `sighup`, `postmaster`). Alterar valor
persistente gera o `ALTER SYSTEM` ou edição de arquivo, com aviso de que é global e que o
servidor pode precisar reiniciar, e com snapshot do valor anterior para reverter.

### 5.6 Logs e arquivos

- `pg_current_logfile`, tamanho, data de rotação.
- Configuração de `logging_collector`, `log_min_duration_statement`.
- Erros recentes do Postgres, com severidade e timestamp.

---

## 6. Segurança

Esta é a seção mais importante. Um gerenciador de banco é a ferramenta mais perigosa que existe
instalada na máquina do DBA. O padrão tem que ser restrictive.

### 6.1 Princípio: o servidor nega, a UI sugere

Toda decisão de permissão é tomada no backend. A UI esconder um botão é conveniência, **não**
controle. Cada endpoint revalida.

### 6.2 Matriz de permissões do módulo

Permissões novas, namespaced, herdando do padrão de roles que já existe:

| Permissão | O que libera | Padrão |
|---|---|---|
| `dbm.connect` | Abrir conexão registrada | `ROLE_ASTRAL_USER` |
| `dbm.browse` | Navegar catálogo e ler metadados | `ROLE_ASTRAL_USER` |
| `dbm.query.read` | Executar `SELECT`/DML de leitura | `ROLE_ASTRAL_USER` |
| `dbm.query.write` | Executar DML | `ROLE_ASTRAL_ADMIN` |
| `dbm.ddl` | Executar DDL | `ROLE_ASTRAL_ADMIN` |
| `dbm.admin.manage` | Criar/dropar banco, usuário, papel | só `ROLE_SUPERADMIN` |
| `dbm.drop_database` | `DROP DATABASE` | só `ROLE_SUPERADMIN` + confirmação |
| `dbm.audit.read` | Ler trilha de auditoria | `ROLE_ASTRAL_ADMIN` |
| `dbm.audit.export` | Exportar trilha | `ROLE_ASTRAL_ADMIN` |
| `dbm.credentials.read` | Ver senha de conexão em claro | **nenhum**, exige quebra de vidro |
| `dbm.restore` | Restaurar backup | `ROLE_ASTRAL_ADMIN` + backup verificado |

O mapeamento papel→permissão fica em `dbm_permissao`, e **não** se cria role nova nos
servidores. Isso evita o problema real do projeto: ERP com `ROLE_ADMIN`/`SUPERUSER`/`SUPERADMIN`
e Astral com `ROLE_ASTRAL_ADMIN`/`USER`, dois vocabulários diferentes.

### 6.3 Escopo de conexão: usuário e papel, não empresa

**Não existe multiempresa no DBM** (§0.15, decisão do dono em 29/09). `empresa` é
conceito de ERP e não aparece aqui nem como coluna. O eixo de escopo é
**usuário, papel, origem e conexão**:

- `dbm_conexao` carrega `criado_por` e `visivel_para` (papel), nunca `empresa_id`.
- Usuário vê as conexões que criou, **mais** as liberadas ao seu papel, **mais** as
  marcadas `global = true`.
- Conexão `global = true` só pode ser criada por `dbm.admin.manage`.
- Todo acesso valida usuário e papel **contra o token**, nunca contra parâmetro do
  request — esse é o caminho clássico de IDOR.
- Logs de execução carregam `usuario_id` e `conexao_id`; a trilha é filtrável por
  esses eixos.
- Conexões que apontam para o **banco interno do próprio DBM** (`astral_dbm`, §0.16.1)
  não aparecem para usuário comum (§0.2 D8).

**`workspace` saiu do eixo de escopo, e é correção.** A versão anterior desta subseção listava
"usuário, papel, origem, conexão e workspace". O `workspace` não tem tabela, não tem coluna em
nenhuma tabela, não aparece em nenhuma tela e não tem consumidor: 2 menções no documento
inteiro, ambas genéricas. E o 14.2, que descreve o eixo campo a campo, diz o contrário, o
eixo é `criado_por` e `visivel_para`, sem workspace. Duas seções do mesmo documento
respondendo diferente sobre a mesma coisa.

Criar `dbm_workspace` e `workspace_id` seria inventar schema sem consumidor, que é exatamente a
categoria do `empresa_id` removido em 0.15: coluna que a tela ofereceria como filtro e que
ninguém preencheria. Se aparecer consumidor de verdade, o workspace volta com a
tabela dele.

### 6.4 Permissões de objeto

Visualizar as permissões de uma tabela (tabela, colunas, sequences, tipos) e gerar GRANT/REVOKE:

- Gera o SQL, mostra o diff, e **não aplica sozinho** — passa pelo caminho de escrita.
- Mostra o que a permissão **realmente** dá, incluindo herança por papel. Permissão herdada que
  não se enxerga é como incidente de segurança acontece.

### 6.5 Permissões de schema e de banco

- Schema: `USAGE`, `CREATE`.
- Banco: `CONNECT`, `TEMPORARY`, `CREATE`.
- Painel que compara a permissão efetiva com a declarada, apontando concessões redundantes
  (ex.: papel concede, e o usuário já está no papel) e permissões órfãs (concedidas a papel que
  não existe mais).

### 6.6 Row Level Security e segurança por coluna

- Listar e criar policies RLS (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`), com editor de
  expressão e aviso explícito de que uma policy mal escrita torna a tabela visível por inteiro.
  Recomendar `FORCE ROW LEVEL SECURITY` na tabela, senão o dono da tabela escapa da policy.
- **Coluna sensível**: permitir marcar colunas como sensíveis para o módulo. A UI mascara por
  padrão e exige permissão para revelar. Isso é ferramenta de apoio, não proteção de verdade —
  o banco continua sendo a fonte. Dizer isso na tela é melhor do que prometer segurança falsa.
- `default_privileges`: listar e gerar GRANT default para objetos futuros.

### 6.7 Lista de negação explícita

O caminho de escrita **recusa** semDiscussão, independentemente de permissão:

| Comando recusado | Motivo |
|---|---|
| `COPY ... FROM 'arquivo'` / `COPY ... TO` com caminho | Lê e escreve arquivo do servidor |
| `pg_read_file`, `pg_read_binary_file`, `pg_ls_dir` | Lê o disco do servidor |
| `lo_import`, `lo_export` | Mesmo problema |
| `pg_terminate_backend` fora da tela de sessões | Pode derrubar serviço de produção |
| `CREATE EXTENSION`, `DROP EXTENSION` | Extensão executa código arbitrário |
| `CREATE/DROP LANGUAGE` + `$$` | Linguagem procedural = execução de código |
| `DO $$ ... $$` | Idem |
| `SET ROLE`, `SET SESSION AUTHORIZATION` | Escalada de privilégio |
| `ALTER SYSTEM`, `ALTER ROLE ... SUPERUSER` | Escala e é global |
| `pg_reload_conf`, `pg_terminate_backend()` | Global |
| `SELECT` em `pg_authid` | Lê hashes de senha |
| `DISCARD ALL`, `RESET ALL` em sessão compartilhada | Afeta as outras abas |

A checagem é feita **no backend**, por parser léxico do statement (não por regex solta no meio do
texto), com bypass explícito e auditado: `dbm.danger.allow` + confirmação digitada + registro
na auditoria com o usuário que liberou. A existência do bypass é intencional: um DBA legítimo
precisa de `CREATE EXTENSION` para instalar `pg_stat_statements`, e um sistema que recusa sem
saída obriga o DBA a sair do módulo e usar `psql` — que é justamente o que se quer evitar.

### 6.7.1 Negação por efeito, não por verbo — e ela roda em leitura

Fechada pelo dono em 29/09. Um `SELECT` pode ter efeito colateral:

- `SELECT minha_funcao_volatil();` — funcao marcada `VOLATILE`/`SECURITY DEFINER`
  que escreve, ou faz I/O, ou chama servico externo.
- `SELECT refresh_materialized_view(...);` — e `SECURITY DEFINER` do proprio Postgres.
- `dblink_exec(...)` em outro banco, via `dblink`/`postgres_fdw`.
- Qualquer `SELECT` que passe por view materializada ou view que chame funcao.

Então a checagem da §6.7 **roda sempre, inclusive em Modo Somente Leitura e em
Modo Operador**, e **nao olha o verbo**. Ela e aplicada sobre a arvore de
execucao do statement:

1. Se o statement referencia funcao/procedimento: o executor exige que a funcao
   esteja numa **allowlist** do papel corrente, OU que o papel nao seja de leitura
   (Operador e DBA passam; Leitura so passa por allowlist).
2. Se o statement e um `SELECT` cujo plano contem `ModifyTable` / `FunctionScan`
   marcado `VOLATILE`: **recusa**, com o motivo `efeito_indireto`.
3. `refresh_materialized_view`, `dblink*`, `lo_*`, `pg_*` de arquivo: sempre recusados.

Isso e a **alternativa 3** da analise (whitelist) funcionando como reforco. Ela nao
e a garantia principal — a garantia principal e a role do banco (§0.7). Mas em SGBD
sem `REVOKE EXECUTE`, e o que fecha o furo.

A allowlist vive em `dbm_execucao_permitida` (schema, funcao, papel), e vem
preenchida por default **vazia para leitura** — ou seja, Leitura so executa
funcao explicitamente liberada. Default vazio e o que faz a regra valer no dia um.

### 6.8 Eficácia e revogação

- Tela que mostra os privilégios **efetivos** do usuário numa tabela, resolvendo herdança de
  papéis e `PUBLIC`.
- Verificação de privilégios órfãos: papel concedido que não existe, `PUBLIC` com privilégio
  indevido, usuário com `BYPASSRLS`, `SUPERUSER` que não deveria.

### 6.9 Credenciais em repouso e em trânsito

- Senha cifrada **pela aplicação**, com a chave em variável de ambiente, e gravada em
  `senha_cifrada BYTEA`. A cifra não é função do banco: o DBM não instala extensão no banco
  dele para cifrar (§0.24). Chave ausente = o módulo não sobe, com mensagem clara — não
  degradar para texto puro.
- A API **nunca** devolve a senha. "Editar conexão" mostra `••••••••` e o usuário pode "trocar"
  sem ver a anterior.
- Exportar conexão gera arquivo sem senha, com aviso na tela.
- Senha só entra em memória no instante de conectar, e é descartada depois.
- `dbm.credentials.read` mostra a senha em claro, com auditoria própria e aviso visível.

### 6.10 MFA, AD, LDAP, Kerberos, SSO

> **ALTERADO em 30/09 (§0.25).** O Auth Service é produto independente e dono dos
> providers AD/Postgres/Linux/Certificado; o DBM consome o contrato e não implementa fonte
> de identidade alguma. As observações de MFA, Kerberos e SSO abaixo continuam como
> contexto de segurança do produto; as que descreviam
> `MultiSourceAuthenticationProvider` como caminho de entrada do DBM estão superadas.


- **AD/LDAP**: entra pela fonte de identidade que já existe
  (`MultiSourceAuthenticationProvider`). O papel do banco continua vindo do ERP, não do AD —
  mapear papel de banco direto para grupo de AD é o tipo de coisa que dá problema às 3 da manhã.
  Recomendação: grupo de AD **autoriza** o acesso ao módulo; o papel decide **o que** fazer.
- **SSO**: herda do fluxo do ERP (`ProxyAuthorizationServer`).
- **MFA**: o ERP decide. O módulo exige que a sessão autenticada tenha MFA quando a política da
  empresa exigir — não implementa MFA próprio.
- **Kerberos**: `setup-kerberos-auth.sh` já existe para a máquina. Kerberos para o **banco** é
  outro assunto e fica fora do escopo da primeira entrega, registrado como pendência.

---

---

## 7. Auditoria

### 7.1 Reaproveitar o que já existe

**O DBM tem auditoria própria: `dbm_auditoria`.** O ERP tem `bc_core_auditoria`
(medido em `V2__core.sql:126`), mas ela morreu como dependência quando o DBM ganhou
banco próprio (§0.15) — reaproveitá-la exigiria FK para `bc_core_empresa` e
`bc_core_usuario`, de um banco que não é o do DBM. Isso **não** é duplicação: é
consequência de um banco por projeto. A tabela nova guarda quem/quando/origem/
resultado/antes/depois. São três: `dbm_auditoria` (objetos e configuração),
`dbm_execucao` (SQL, §7.3) e `dbm_negativa` (§7.5).

### 7.2 O que é registrado

Toda ação gera registro: **quem** (`usuario_id`), **de qual papel**, **de qual origem**
(`usuario`/`job`/`evento`/`api`), quando, IP, user agent, conexão, objeto afetado,
operação, resultado (`ok`/`falha`/`negado`), duração, e erro quando houve.

Operações que **não** deixam registro: abrir a tela, expandir a árvore, pedir autocomplete.
Registrar leitura de catálogo só polui.

### 7.3 Auditoria de SQL — o buraco que o padrão não cobre

`dbm_auditoria` (§14.8) tem `objeto_tipo`/`objeto_nome`/`schema_nome`, que é o papel do
`registro_id` do padrão antigo — mas SQL solto **não tem** entidade nem id, e forçar um
id fictício seria inventar dado. Por isso a trilha de SQL é tabela própria:

`dbm_execucao`: `id, uuid, usuario_id, papel, conexao_id, sql_text, sql_hash,
norm_sql, tipo (SELECT/DML/DDL/DCL), status, linhas_afetadas, duracao_ms, erro,
ip, user_agent, created_at`.

`norm_sql` guarda o SQL com literais substituídos por `?`, que é o que permite agrupar "topo
consultas" por identidade e não por texto.

### 7.4 Event trigger — a parte que ninguém faz

Sem isso, a trilha é **auto-relato**: registra o que o módulo fez e nada do que aconteceu.
Um `psql` no mesmo banco deixa zero rastro.

Event trigger no Postgres para `ddl_command_end` e `sql_drop`, registrando objeto, comando,
tipo de comando e sessão. Requisitos e custo, ditos com honestidade:

- Exige superusuário para instalar. O módulo detecta a ausência e **informa que a auditoria
  está parcial** em vez de fingir cobertura total.
- É superfície de ataque conhecida: `search_path` e funções de trigger são vetor documentado.
  Precisa de `SECURITY DEFINER` com `search_path` fixo, dono dedicado e `EXECUTE` revogado do
  `PUBLIC`.
- Volume: um trigger por DDL é barato. Um trigger por statement de SELECT seria insuportável —
  por isso só DDL.
- Enquanto não estiver instalado, a tela de auditoria mostra selo de "cobertura parcial".

### 7.5 Trilha de backup

`dbm_backup`: `id, uuid, usuario_id, conexao_id, arquivo, formato, nivel, tamanho_bytes,
checksum_sha256, duracao_ms, status, erro, verificado, usuario_id, created_at`.

**Backup só entra como válido depois de verificado**: o arquivo existe, tem tamanho maior que
zero, o checksum bate, e o cabeçalho foi lido. Backup não verificado aparece na lista com selo
vermelho e é recusado pelo fluxo de restore.

### 7.6 Tentativas negadas

Falha de permissão, statement na lista de negação (§6.7), `statement_timeout`, conexão recusada
e cancelamento vão para `dbm_negativa`, com `motivo` estruturado. Separar Negado de Erro
importa: negação é sinal de segurança e merece alerta; erro é ruído.

### 7.7 Consulta, filtros e exportação

Filtros: período, usuário, papel, conexão, origem, operação, objeto, resultado, IP, texto livre.
Diferença visual entre `antes` e `depois` com destaque.
Exportação CSV, JSON e PDF, sempre com o filtro aplicado e o total no rodapé — "o filtro não
está no arquivo exportado" é o jeito clássico de entregar relatório errado em reunião.

### 7.8 Retenção

- Particionamento mensal em `dbm_auditoria` e `dbm_execucao`.
- Retenção padrão de 24 meses, configurável em `dbm_configuracao` (global do DBM).
- Partições antigas são despejadas, arquivadas e removidas: auditoria não pode custar mais caro
  que o sistema auditado. Regra de custo: auditoria ≤ 5% do armazenamento total.
- Fluxo: `ALTER TABLE ... DETACH PARTITION`, `pg_dump` da partição, `DROP` — executado por job.

---

## 8. Monitoramento

### 8.1 Coleta

`pg_stat_activity`, `pg_stat_database`, `pg_stat_user_tables`, `pg_stat_user_indexes`,
`pg_locks`, `pg_stat_io` (quando disponível), `pg_stat_statements` (§8.6).

Coleta por job a cada 60s, escrita em tabelas de série temporal com agregação. Ler as views de
estatística a cada requisição da UI colocaria o próprio painel como carga do banco.

### 8.2 Séries temporais

`dbm_metrica_serie` guarda amostras; `dbm_metrica_agregado` guarda hora/dia/mês já
reduzido (min, max, média, p95, p99). Retenção: 15 dias em cru, 13 meses agregado, 5 anos em
diário. **p95 e p99, não só média**: média esconde exatamente o pico que o usuário sente.

### 8.3 Painéis

| Painel | Métricas |
|---|---|
| Servidor | CPU, load, memória, swap, disco por filesystem, I/O |
| Banco | conexões (ativas, ociosas, por estado), commits/s, rollbacks/s, tamanho, crescimento |
| Pool | conexões em uso, em espera, no limite |
| Consultas | QPS, tempo médio, p95, p99, mais lentas, mais frequentes |
| Locks | sessões esperando, por classe de espera |
| Cache | hit ratio por tabela e global |
| I/O | blocos lidos/escritos, await, por tablespace |
| Réplica | lag deReplication e de replay, posição, atraso doSlots |
| Storage | por banco, por tabela, crescimento diário |
| Jobs | backups, restores, vacuum, jobs agendados: sucesso, falha, duração |

**Os 10 painéis acima são métrica de infraestrutura, e nenhum deles é indicador.**
Painel mostra número; indicador mostra `valor · cobertura · medido_em · fonte`
(§0.17), e por isso tem tela própria no bloco `Inteligência` da §1 (§0.21.2). A
separação é deliberada: misturar as duas coisas numa tabela só faria o painel
exibir `Health Score 94` sem o `5 de 6 fatores` ao lado, que é exatamente o
score decorando cobertura que o §0.17 proíbe.

### 8.4 Alertas

Tabela `dbm_alerta_regra`: `conexao_id, metrica, operador, limiar, janela_min, severidade,
canais, ativo`. Canais: e-mail, log, evento na UI, webhook, AMQP.

Severidade: `INFO`, `AVISO`, `CRITICO`. Anti-ruído obrigatório:eminha uma vez por entrada em
queda, uma quando volta, e cooldown. Alerta que repete a cada minuto deixa de ser lido em uma
semana.

Disparadores que já valem a pena no Postgres:
- conexões > 80% de `max_connections`; > 90% crítico
- transações ociosas em transação (`idle in transaction`) > 60s
- lock sustentado > 30s
- taxa de rollback > 5%
- hit ratio < 95%
- backup falhou
- disco < 15% livre
- replicação atrasada > 60s
- vacuum não rodou em tabela grande

### 8.5 Latência de aplicação

O módulo mede a própria latência: tempo entre a UI pedir e a API responder, e tempo de espera
por pool de conexões. Um painel que só olha o banco e ignora o próprio gargalo é inútil na hora
de diagnosticar lentidão.

### 8.6 Pré-requisitos do Postgres

```sql
-- shared_preload_libraries = 'pg_stat_statements'  (exige reinício)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```
`pg_stat_statements` é o único item, e é dependência de reinício: precisa ser item de
instalação, com aviso explícito. Ele entra pelo bypass auditado da §6.7 (`dbm.danger.allow`),
não pelo caminho de escrita.

`pgcrypto` saiu da lista em 29/09: o DBM não tem consumidor para nenhuma função dela, e
`gen_random_uuid()` — a razão que a spec citava — é núcleo desde o PostgreSQL 13 (§0.24).
`uuid-ossp` continua listado, mas a justificativa anterior ("já está em uso no ERP") é
**erro de raciocínio, não fato**: extensão em PostgreSQL é por banco, e o uso em
`brasil_saas` não diz nada sobre o banco de um cliente. Se o DBM precisar de função de
`uuid-ossp` na introspecção de alvos, isso **não foi medido** e fica em aberto.

---

## 9. Gerenciador de objetos

### 9.1 Tabelas

- Lista: nome, owner, schema, tipo (comum, materializada, particionada, temporária, externa),
  linhas estimadas, tamanho, bloat, última mudança de DDL, encoding, tipo de replicação.
- Detalhe em abas: Colunas, Restrições, Índices, Triggers, Policies, Comentários, Estatísticas,
  Partições, Heranças.
- Editor visual de tabela (§10.2) que **não escreve por baixo dos panos**: gera o SQL, mostra
  o diff, e o caminho normal é pelo caminho de escrita.

### 9.2 Colunas

Nome, tipo com precisão, `NOT NULL`, default (bruto e expressão), identidade, gerada,
coluna virtual, comentário, posição, collation. Editor com validação por tipo e detecção de
ordem de colunas herdadas.

### 9.3 Restrições

PK (nome, colunas, método, deferrable), FK (colunas, referenciada, ações `ON DELETE`/`ON
UPDATE`, validação, `NOT VALID`), UNIQUE, CHECK com a expressão legível, EXCLUDE.

OEditor de FK oferece as ações e mostra o que acontece com os órfãos existentes — `ON DELETE
CASCADE` apaga dados em cascata e isso precisa estar escrito na tela, não implícito.

### 9.4 Índices

Nome, tabela, método (btree, hash, gin, gist, brin, spgist), colunas e expressões, `INCLUDE`,
único, parcial com predicado, `WHERE`, tamanho, uso (quantas vezes foi usado desde o
`stats_reset`), mais índices não usados.

Índices não usados são custo puro: pagar escrita para nunca ler. Sugerir remoção é utilidade,
executar remoção é decisão do usuário, e mesmo assim passa por confirmação e auditoria.

### 9.5 Views

Definição, colunas, `security_invoker`, `check_option`, dependências (a árvore mostra
"quem usa esta view"), e a view expandida com as tabelas base.

### 9.6 Funções e procedimentos

Nome qualificado, tipo, idioma (SQL ou plpgsql), argumentos com nome, tipo e modo
(`IN`/`OUT`/`INOUT`/`VARIADIC`), valor de retorno, `STRICT`, `SECURITY DEFINER`, `SET` de
search_path, corpo, comentário.

**Alerta obrigatório em `SECURITY DEFINER`**: verificar o `search_path`. Função
`SECURITY DEFINER` com `search_path` mutável é a porta clássica de escalada de privilégio no
Postgres, e a tela tem que apontar isso em vez de só mostrar o SQL.

### 9.7 Triggers

Evento (BEFORE/AFTER/INSTEAD OF), operação (INSERT/UPDATE/DELETE/TRUNCATE), tabela alvo,
nível (linha ou statement), condição `WHEN`, funções chamadas, atraso (`DEFERRED`/`IMMEDIATE`),
tabela de transição, habilitada. Editor com construtor visual que monta o SQL.

### 9.8 Policies

Nome, tabela, comando, `USING`, `WITH CHECK`, `PERMISSIVE`/`RESTRICTIVE`, papéis. Painel que
compara RLS, owner e `FORCE ROW LEVEL SECURITY`: owner sem `FORCE` escapa da própria policy, e
isso é a falha mais comum de RLS em produção.

### 9.9 Sequências, domínios, tipos, extensões

- Sequências: valor atual, `MINVALUE`/`MAXVALUE`, `CACHE`, `OWNED BY`, `INCREMENT`. Botão de
  **alinhar a sequência com o max da coluna** — é a correção da falha mais comum de identidade.
- Domínios e tipos: definição, constraints, base. ENUM com os valores, editáveis.
- Extensões: nome, versão instalada, versão disponível, schema, se é confiável
  (`superuser`, `trusted`).

---

## 10. Geração automática de SQL

### 10.1 Princípio

Nada escreve sozinho. O módulo é um **gerador de SQL** com revisão, diff e confirmação. O SQL
gerado é o artefato: o usuário lê, ajusta, e aí executa. Isso também torna a geração testável —
o SQL gerado é comparável com o esperado em teste automatizado.

### 10.2 Assistentes visuais

**Designer de tabela** — colunas em grade (nome, tipo, precisão, NN, PK, default, comentário),
chave primária composta, FKs em painel separado, índices em painel separado. Gera:

```sql
CREATE TABLE schema.tabela (
  id      BIGSERIAL PRIMARY KEY,
  nome    VARCHAR(160) NOT NULL,
  criado  TIMESTAMP NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE schema.tabela IS '...';
COMMENT ON COLUMN schema.tabela.nome IS '...';
```

**Designer de índice** — colunas, `ASC`/`DESC`, `NULLS FIRST/LAST`, expressão, `INCLUDE`,
parcial com predicado. Gera `CREATE INDEX` ou `ALTER TABLE ADD CONSTRAINT` para unique, e
oferece `CREATE INDEX CONCURRENTLY` quando a tabela é grande — que é a diferença entre uma
operação de segundos e uma que trava a tabela.

**Designer de FK** — colunas, referenciada, ações, `NOT VALID` para tabela grande, e o
diagnóstico de quantos órfãos existem antes de aplicar. Gera `ALTER TABLE ... ADD CONSTRAINT`.

**Designer de trigger** — evento, operação, timing, `WHEN`, corpo. Gera `CREATE FUNCTION` +
`CREATE TRIGGER`, e **sempre** com `SET search_path` na função de trigger.

**Designer de procedure/function** — cabeçalho, argumentos, corpo com realce, e
`SECURITY DEFINER` com `search_path` fixo por padrão quando o usuário marcar como privilegiado.

**Designer de policy** — comando, expressões `USING`/`WITH CHECK`, papéis. Gera
`CREATE POLICY` e lembra de `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.

**Designer de índice único, restrição CHECK e sequência** — mesmos padrões, menos campos.

### 10.3 Geração a partir do estado existente

- "Gerar script de criação" de qualquer objeto ou de um schema inteiro: produz o DDL na ordem
  correta de dependência (tipo → domínio → sequência → tabela → índice → view → função →
  trigger → grant). Ordenar errado é o modo mais comum de esse recurso gerar script que não roda.
- "Gerar drop" correspondente.
- "Gerar script de diff" contra outro banco ou outra versão (§11.1).

### 10.4 Geração de dados

Gerador de `INSERT` com volume, para carga de teste: tipos, sequências,intervalo de valores,
relacionamento, e a possibilidade de gerar direto via `COPY` (com as restrições de §6.7).
---

## 11. Recursos Enterprise

O que separa um gerenciador de Hobby de uma ferramenta corporativa. Cada item aqui é
diferença real de custo e de risco.

### 11.1 Schema diff e comparação

- Duas conexões (ou duas versões do mesmo banco) lado a lado.
- Diff **estruturado**, não de texto: tabela adicionada/removida, coluna, tipo alterado,
  nullability, default, PK, FK, índice, sequence, trigger, policy, grant.
- Gera o SQL de migração: `ADD COLUMN`, `DROP COLUMN`, `ALTER TYPE`, `CREATE INDEX
  CONCURRENTLY` quando a coluna é grande.
- Detecta e **avisa** operação destrutiva que perde dado (`DROP COLUMN` com dados,
  `ALTER TYPE` incompatível), e permite gerar backup antes de executar.
- Opção **somente leitura**: mostra o diff e não gera SQL — útil em auditoria e em aprovação.

### 11.2 Comparação de dados

- Amostra por chave primária, em lote, com número de linhas por chunk.
- Mostra divergência campo a campo, e gera `UPDATE`/`INSERT`/`DELETE` para alinhar.
- Respeita a mesma confirmação e a mesma trilha de auditoria. Comparação de dados é escrita
  potencial: é classificada como escrita, não como leitura.

### 11.3 Migrações versionadas

- Diretório de migrações (como Flyway), cada arquivo com `V<n>__<descricao>.sql`.
- Histórico aplicado, checksum por versão — **mudança em versão já aplicada é detectada**.
- Estados: pendente, aplicada, falhada (com o erro), revertida.
- `dry-run` mostra o SQL e o plano (o que a migração faz, quantas linhas toca, tempo estimado).
- Lock de migração: duas pessoas não aplicam ao mesmo tempo.
- Hooks: pré e pós, para invalidação de cache e notificação.

### 11.4 Deploy e rollback

- Deploy = aplicar migrações pendentes em ordem, com verificação entre etapas.
- **Rollback por script** (não automático: `DROP COLUMN` não tem volta). A ferramenta mantém o
  script de reversão ao lado do de avanço e mostra qual dele é reversível.
- Janela de manutenção, modo "somente leitura" para o app durante a migração, e aviso para
 os clientes conectados.

### 11.5 Aprovação (workflow)

- Fluxo: authored by alguém → revisor → aprovador → aplicado.
- Papel `dbm.deploy.approve`. Aprovação registrada na auditoria.
- "Deploy direto" continua existindo para quem tem a permissão, mas **fica registrado** que foi
  feito sem aprovação, em destaque na trilha. Ferramenta de produção tem que permitir o atalho,
  porque workflow sem atalho só gera contorno.

### 11.6 Multiusuário e concorrência

- Duas pessoas editando a mesma tabela em abas diferentes: aviso de lock de edição por objeto,
  com TTL e refresh.
- Duas pessoas no mesmo objeto estrutural (índice, trigger): serializa por lock com dono e
  tempo de expiração, e mostra quem segura.
- Suporte a múltiplas instâncias: locks em **Redis** (não em memória), porque memória em
  cluster dá dois donos ao mesmo tempo.

### 11.7 Change tracking

- Marca quem mudou o quê, quando, e o antes/depois por versão, sem depender de log de DDL.
- Relatório de mudança por período, por objeto, por usuário.
- Importa de trigger de auditoria quando existe; é a **mesma** fonte da §7.4, o que evita duas
  trilhas que discordam.

---

## 12. Experiência de usuário

### 12.1 Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl+Enter` | Executar statement (seleção ou sob cursor) |
| `Ctrl+Shift+Enter` | Executar tudo |
| `Ctrl+.` | Cancelar execução |
| `Ctrl+Space` | Autocomplete |
| `Ctrl+Shift+Space` | Documentação do item |
| `Ctrl+/` | Comentar bloco |
| `Ctrl+S` | Salvar no histórico/favoritos |
| `Ctrl+Shift+F` | Busca global de objeto |
| `Ctrl+D` | Duplicar statement |
| `Ctrl+L` | Limpar resultados |
| `Ctrl+Shift+T` | Nova aba |
| `Ctrl+W` | Fechar aba (pergunta se há transação aberta) |
| `Ctrl+Shift+C` | Abrir terminal SQL |
| `F5` | Atualizar a árvore da conexão |

### 12.2 Menu de contexto por objeto

Clicar direito numa tabela, índice, coluna, schema, role, usuário: ações aplicáveis **só** a
aquele objeto, com as ações destrutivas separadas por divisor e em cor de alerta. Nada de "Apagar"
no mesmo grupo de "Abrir".

### 12.3 Drag and drop

- Arrastar tabela da árvore para o editor gera `SELECT *` / nome qualificado.
- Arrastar coluna gera a coluna com o alias da tabela.
- Arrastar arquivo `.sql` para a área de trabalho abre em nova aba.
- Reordenar colunas do resultado salva a ordem de exibição por usuário.

### 12.4 Busca global

Um campo, um resultado. Busca em todos os objetos de todas as conexões visíveis, com filtro por
tipo. Ela serve também **tabelas e colunas**, não só objetos nomeados — achar a coluna
`data_emissao` espalhada em 40 tabelas é uso diário.

### 12.5 Quick Actions

Paleta de comando (`Ctrl+K`): executar, novo backup, vacuum, ver painel, abrir terminal, modo
leitura. **Só ações permitidas ao usuário** — uma paleta que mostra o que você não pode fazer é
ruído.

### 12.6 Painéis destacáveis

Painel de sessão pode destacar: resultado, plano, histórico. Layout persiste por usuário.
Arrastar para fora cria janela separada, para segundo monitor — quem faz DBA o dia inteiro
precisa de dois monitores.

### 12.7 Terminal SQL

- Prompt customizável, com `nome@host:port dbname`.
- Histórico com `↑`/`↓`, busca no histórico por `Ctrl+R`, e_save em arquivo.
- Sem reprodução de caracteres de senha na tela — entrada mascarada quando o destino pedir
  senha.

### 12.8 Papéis finais — três modos

Fechado pelo dono em 29/09. A distinção nao e "quanto de escrita", e **quanto de
dado** o papel ve e pode levar embora.

**Somente Leitura** — publico: desenvolvedor, auditor, analista.
Visualiza catalogo, visualiza metadados, visualiza DDL. **Sem acesso aos dados**,
sem execucao SQL arbitraria, **sem exportacao**. No banco, conecta em `dbm_leitura`.
E o papel de quem abre o banco para ver estrutura; levar dados embora nao e o
papel dele.

**Operador** — consulta dados, executa SELECT, exporta **dentro dos limites**.
Sem DML, sem DDL, sem administracao. No banco, conecta em `dbm_operador`, com
`GRANT SELECT`, `REVOKE INSERT/UPDATE/DELETE`, e `REVOKE EXECUTE` onde aplicavel.
Limites que cortam exportacao (§6.7, §14.2):
- `max_linhas_exportacao` — teto de linhas por exportacao
- `schemas_visiveis` — quais schemas ele enxerga
- `objetos_visiveis` — filtro de tabelas/views sensiveis
Esses tres vao **na V100**; nao podem esperar.

**DBA** — DDL, DML, backup, restore, administracao. Tudo auditado (§7). Escrita
desligada por padrao e liberada deliberadamente (§0.4).

**Modo e papel sao coisas diferentes.** O papel define **o que voce e**; o modo
define **o estado da sessao agora**. Um DBA pode estar em Modo Leitura numa aba
e Modo DBA noutra, ao mesmo tempo, na mesma workbench (§2.3). O papel nunca muda;
so o modo, e so nesta sessao.

---

## 13. Arquitetura sugerida

### 13.1 Stack

- **Backend**: Java 21, Spring Boot 3.3.5, Spring Security, Maven — o mesmo build do ERP.
- **Banco do sistema**: PostgreSQL (já é o datastore do ERP).
- **Cache e locks**: Redis (já configurado no ERP).
- **Filas**: RabbitMQ (já configurado no ERP) para jobs longos.
- **Frontend**: React + PrimeReact `^10.8.0` + Vite, servido pelo próprio jar (sem servidor de
  arquivos estático separado, como o ERP já faz).
- **Proxy**: Nginx TLS na frente, como no Astral.
- **Container**: Dockerfile e `docker-compose.yml`, como o ERP já tem.

### 13.2 Camadas

```
comando (REST)
    ↓
Controller        valida entrada, devolve ApiResponse (padrão do ERP)
    ↓
Service           regra de negócio, permissão fina, confirmação, auditoria
    ↓
Segurança         matriz §6.2, escopo do token (usuário/papel), lista de negação §6.7
    ↓
Executor          statement_timeout, teto de linhas, cancelamento, transação, sem auto-commit
    ↓
DriverManager     JDBC genérico: localiza/baixa/registra driver, cria conexao
    ↓
Camada JDBC       DatabaseMetaData, ResultSet — SEM SQL proprietario aqui
    ↓
Adaptador (opcional)  Explain, Locks, Replication, Backup, Performance (§0.9 N2)
```

**O núcleo fala JDBC, e só isso.** Tudo que o padrão cobre — conectar, executar,
metadados, schemas, tabelas, views, colunas, ResultSet, transação — passa por
`java.sql` e funciona para qualquer banco com driver (§0.9 N1). O adaptador é
consultado **só** para capacidade que o JDBC não padroniza, e sua ausência nunca
impede operar: sem adaptador, o sistema cai para Nível 1 (§0.9).

A porta deixou de ser "um `BancoTarget` por banco". É um `DriverManager` único mais
`CapacidadeAdapter` opcional. Isso é o que faz "banco novo" ser **download de driver**,
não sprint de implementação.

### 13.3 Entidades e tabelas (resumo; detalhe em §14)

`Conexao` (registrada, com driver, url, **usuario_bd**, senha cifrada, schema padrão, criado_por, global),
`Usuario` e `Papel` (identidade e RBAC — **não existiam** antes desta reescrita,
§14.1), `Conexao`, `GrupoConexao` (pastas de ambiente), `Sessao` (workbench, Redis),
`HistoricoQuery`, `Favorito`, `Snippet`, `Auditoria`, `Execucao`, `Negativa`, `Backup`,
`Restore`, `Job`, `AlertaRegra`, `AlertaEvento`, `MetricaSerie`, `MetricaAgregado`,
`Mudanca` (change tracking), `Migration`, `Aprovacao`, `Permissao`, `PermissaoEscopo`,
`FuncaoPermitida`, `Driver`, `Configuracao`.

Identidade e conexão vêm **primeiro** na ordem de criação, porque todas as outras
tabelas têm FK para elas.

### 13.4 Filas e eventos (RabbitMQ)

Jobs longos **não** rodam no request HTTP:

| Fila | Consumer | Job |
|---|---|---|
| `dbm.backup` | 1 (serializado por conexão) | `pg_dump`/`custom`, checksum, verificação |
| `dbm.restore` | 1 | `pg_restore`, verificação, **exige** backup verificado |
| `dbm.export` | N | exportação grande de resultado |
| `dbm.vacuum` | 1 | vacuum/analyze/reindex com log |
| `dbm.integridade` | 1 | verificação, achados estruturados |
| `dbm.diff` | N | diff de schema e de dados |
| `dbm.deploy` | 1 | aplicar migrações, com lock |
| `dbm.alerta` | N | avaliar regras, notificar |

Regras: **serialização por conexão** (dois backups do mesmo banco ao mesmo tempo é receita de
problema), idempotência por chave, DLQ com alerta, e o job registra início/fim/falha em
`dbm_job` — job que não reporta é job que ninguém percebe quebrado.

### 13.5 Eventos de domínio

Publicados para `astral.eventos` e consumidos pelas IAs e pela auditoria: `dbm.consulta.executada`,
`dbm.ddl.executado`, `dbm.backup.concluido`, `dbm.backup.falhou`, `dbm.conexao.aberta`,
`dbm.negativa.registrada`, `dbm.deploy.aplicado`, `dbm.alerta.disparado`. Cada evento com
`usuario_id`, `papel` e `conexao_id` — o mesmo eixo de escopo das tabelas (§6.3), e
não `empresa_id`, que não existe aqui.

### 13.6 Cache (Redis)

- Árvore de metadados por conexão: `dbm:cat:<conexao>:<banco>` TTL 10min, invalidados quando o
  catálogo muda (§13.7).
- `dbm:pool:<conexao>` para o pool e estado de sessão.
- `dbm:wb:<usuario>:<sessao>` para o workbench (§2.4).
- `dbm:lock:<objeto>` para locks de edição e de deploy.
- `dbm:neg:<ip>:<chave>` para rate limit de tentativas de login e de negação repetida.
- `dbm:metrics:cache` para resultados de stats, TTL 60s.

### 13.7 Invalidação de cache

Sem invalidação, o usuário navega por um catálogo velho e toma decisão sobre estrutura que não
existe mais. Três gatilhos, nesta ordem de confiança:

1. Event trigger de DDL (melhor: pega mudança de qualquer origem, inclusive fora do módulo).
2. `updated_at`/OID das tabelas de catálogo comparado a um snapshot.
3. TTL como rede de segurança — não como mecanismo principal.

### 13.8 Permissões

Matriz `dbm_permissao` (papel → permissão), namespaced `dbm.*`, avaliada por
`@PreAuthorize("hasAuthority('dbm.ddl')")` no método do service, **não** só no controller —
assim um service chamado por job herda a mesma regra.

Os papéis vivem em `dbm_papel` (§14.1), semeados, e o token traz as autoridades que o
DBM confere. A linha do ERP saiu: o DBM não tem como validar um papel que vive em
outro banco, e aceitar o nome sem o controle seria a pior das duas metades.

Papéis → permissões:

| Papel | Permissões |
|---|---|
| `ROLE_ASTRAL_USER` | `connect`, `browse`, `query.read` |
| `ROLE_ASTRAL_ADMIN` | acima + `query.write`, `ddl`, `audit.read`, `audit.export`, `restore` |
| `ROLE_SUPERADMIN` | tudo, incluindo `admin.manage`, `drop_database`, `deploy` |
| `ROLE_SUPERUSER` | como admin, **sem** `drop_database` |
| ~~`ROLE_ADMIN` (ERP)~~ | **removido em 29/09** — o DBM não valida papel de outro banco |

### 13.9 Auditoria

Grava em `dbm_auditoria` + `dbm_execucao` + `dbm_negativa`, no `astral_dbm` (§7). Gravação
**assíncrona**: num job/evento, nunca no caminho crítico de uma query, porque auditoria que
atrasa o banco é auditoria que alguém desliga.

---

### 13.10 Lista fechada da V100 — o que entra na primeira migration

Fechado pelo dono em 29/09. `V100__dbm_inicial.sql` entrega, obrigatoriamente:

**O arquivo existe e foi verificado** (29/09): `docs/dbm/V100__dbm_inicial.sql`,
16 tabelas. Escrito e versionado junto da especificação porque o **lugar de execução**
continua em decisão (§0.22.4) — o SQL não depende de onde roda, e o processo sim.

> **ALTERADA APÓS VALIDAÇÃO — não revalidada.** Em 29/09 a linha
> `CREATE EXTENSION IF NOT EXISTS pgcrypto` foi retirada do arquivo por ser dependência sem
> consumidor (§0.24). A versão **em disco** está com 704 linhas e **não foi commitada**; a
> versão **validada** tem 706 linhas e é a que está no histórico. O DDL é equivalente
> (16 tabelas, 18 `COMMENT ON TABLE`, 11 guardas, 26 índices, 24 FK, 12 `gen_random_uuid()`
> — medido, igual nas duas), mas **equivalente não é validado**: a revalidação vai ocorrer no
> ambiente definitivo de `astral_dbm` e **não no Astral**. A ordem é ambiente próprio, depois
> revalidação — nunca o contrário.

Verificação **por dado, não por leitura**: roda no Flyway 10.17.0 real contra
PostgreSQL 18.6, em schema de rascunho descartável. O Flyway 10 declara suporte até
PG 16, então é **Nível 2, não certificado** — o mesmo rótulo que
`dbm_driver.suportado_nivel` carrega, e a honestidade começa em não esconder o número
da máquina.

O que a verificação pegou e a leitura não pegaria:

| Achado | Como se manifestou |
|---|---|
| `ON DELETE SET NULL` em `dbm_historico_query`, com a coluna `NOT NULL` | a FK aceitaria e a escrita quebraria em runtime. A regra 3 do cabeçalho proíbe, e a autovalidação acusou |
| partição de **um dia** com nome de mês: `dbm_auditoria_2026_09` ia de 09-01 a 09-02 | `date + 1` soma um dia, não um mês. Rodava **sem erro**: a gravação do dia caía na partição `DEFAULT` e ela crescia sem ninguém ver. Só apareceu porque o teste perguntou **em qual partição a linha parou** |
| fronteira com hora duplicada: `"2026-09-01 00:00:00 00:00:00"` | `date + interval` vira `timestamp`; o cast `::date` é obrigatório. Esta falhou no `migrate` |
| `dbm_conexao.driver` era `TEXT` | com duas versões do mesmo fabricante, `nome` não é único, então não dava para referenciar por nome. Texto livre guardava `"PostgreSQL 42.7.13"` sem conferência e a conexão **só falhava ao abrir** |
| `dbm_driver` e `dbm_execucao_permitida` **não tinham balde de migration** | existiam na §14 com consumidor, API e tela no mapa, e não estavam na V100 nem na lista de fora. Passaram para a V100 |

**A migration se autovalida.** O `DO` block final falha a migration se: aparecer
`empresa_id` ou prefixo `bc_`; existir coluna de senha de login; houver FK com
`CASCADE` ou `SET NULL`; `dbm_auditoria` ou `dbm_execucao` deixar de ser particionada;
faltar qualquer uma das 16 tabelas; `source` virar enum fechado; `dbm_conexao.driver`
voltar a ser coluna solta; a regra *verificado → checksum* sumir do `dbm_driver`; ou a
semente de `dbm_papel`/`dbm_configuracao` ficar incompleta.

Testado com **11 casos: 1 controle e 10 violações induzidas**, todos com o resultado
esperado. O controle é o que dá valor aos outros dez — sem ele, "acusou" pode só
significar "quebrou por outro motivo". Honra do resultado: 8 das 10 violações
acusaram pela guarda pretendida; 2 acusaram por erro de sintaxe, porque remover a
semente deixou ponto e vírgula pendurado. As guardas de semente já tinham sido
provadas em rodada anterior, com substituição sintaticamente válida.

**Balde de migration de cada tabela.** Toda tabela da §14 tem que estar na V100 ou
nomeada como fora dela. Tabela sem balde é o sumiço da §0.20.3 um nível abaixo: não é
"ninguém sabia que existia", é "ninguém sabe em qual migration ela nasce".

| Balde | Tabelas |
|---|---|
| **V100** | as 16 criadas: identidade (3), conexões (2), trabalho do usuário (4), RBAC (3), auditoria (3), driver (1) |
| **Explicitamente fora** (§0.5, §15.1) | `dbm_metrica_serie`, `dbm_metrica_agregado`, `dbm_score`, `dbm_mudanca`, `dbm_migration`, `dbm_aprovacao`, `dbm_job`, `dbm_backup`, `dbm_alerta_regra`, `dbm_alerta_evento` |
| **Fora do Postgres: Redis** (§14.4) | `dbm_sessao` — estado volátil e descartável, implemented em `dbm:wb:` |
| **Mortas** (§0.18) | `dbm_usuario_papel`, `dbm_favorito_compartilhado`, `dbm_layout` — citadas na §14 só para dizer que não existem |
| **Role do banco ALVO, não tabela** (§0.7) | `dbm_leitura`, `dbm_operador` — `CREATE ROLE` no Postgres que se administra, nunca no `astral_dbm` |

As três tabelas de inteligência entram fora porque a V100 é a primeira fatia e nenhum
indicador é visível sem elas. Nomeá-las aqui é o que impede o mesmo sumiço da §0.20.3:
tabela existindo na §14 mas ausente da V100 parece bug, quando é recorte de escopo.

Backup e restore fora da V100 é consequência direta da sua decisão: **restore sem
staging não é botão** (§15.3). Backup sai verificado quando entrar.

**Identidade primeiro** — todo o resto tem FK para estas
- `dbm_usuario` (perfil, **sem senha** — §0.19) e `dbm_papel` (catálogo, semeado
  dos papéis do Astral). **Sem `dbm_usuario_papel`**: papel é fato da fonte (§14.1)
- `dbm_configuracao` (chaves de §14.19)

**Conexões e trabalho do usuário**
- `dbm_conexao` com os campos de escopo: `somente_leitura`, `max_linhas_exportacao`,
  `schemas_visiveis`, `objetos_visiveis`, `criado_por`, `visivel_para` (§12.8, §6.3)
- `dbm_grupo_conexao`, `dbm_sessao_historico`, `dbm_historico_query`,
  `dbm_favorito`, `dbm_snippet`, `dbm_permissao`
- **Sem `CREATE SCHEMA`**: o schema é `public` do `astral_dbm` (§14)

**Banco alvo — o que é aplicado no Postgres alvo, não no banco do sistema**
- `dbm_leitura` e `dbm_operador` criadas por conexão, com `REVOKE EXECUTE ON ALL
  FUNCTIONS ... FROM PUBLIC` e `ALTER DEFAULT PRIVILEGES` (§0.7)
- `pg_stat_statements` instalado, com aviso de reinício (§8.6)
- Event trigger de `ddl_command_end` instalado **ou** o selo de "cobertura parcial"
  ativo e visível (§7.4)

**Auditoria — antes de qualquer escrita**
- `dbm_auditoria`, `dbm_execucao`, `dbm_negativa`, `dbm_permissao_escopo`
- FK com `ON DELETE RESTRICT`: sem cascade e sem `SET NULL` em coluna de trilha (§14)
- Gravação assíncrona (§13.9)

**Executor**
- `statement_timeout` e teto de linhas **na conexão** (§0.2 D5)
- Negação §6.7 por **efeito**, rodando também em leitura (§6.7.1)
- Cancelamento, transação explícita, **sem auto-commit** (§0.2 D4)

**Frontend**
- Árvore de objetos, editor com autocomplete por catálogo, resultado em grid,
  histórico e favoritos
- Indicador de modo na barra, com **ESCRITA** em destaque quando liberado (§0.4)
- Trilha de auditoria com antes/depois e selo de cobertura parcial

**Explicitamente fora da V100** (§0.5 e §15.1): Firebird, InterBase, MySQL, SQL
Server, Oracle; diff de schema; migrações versionadas; deploy e aprovação;
monitoramento com painéis e alertas; backup e restore; e a camada de inteligência
(`dbm_metrica_serie`, `dbm_metrica_agregado`, `dbm_score`, 14.21).

---

## 14. Banco interno do DBM (`astral_dbm`)

> **Reescrita em 29/09** por duas decisões do dono: o banco é próprio (§0.16) e
> `empresa_id` não existe (§0.15, §0.18). A seção anterior descrevia o banco
> interno do DBM como schema dentro do banco do ERP — isso morreu. O que segue é
> o modelo relacional do banco `astral_dbm`, no schema `public`.

Padrão de todas as tabelas: `id BIGSERIAL PK`, `uuid UUID DEFAULT gen_random_uuid()`,
`created_at TIMESTAMP DEFAULT NOW()`, `updated_at TIMESTAMP`. **Sem `empresa_id`** e
**sem `bc_`**: o escopo é `usuario_id` / `papel` / `conexao_id`, e o prefixo é `dbm_`
(§0.18).

O schema é `public` dentro de `astral_dbm`. Schema separado só faria sentido em banco
compartilhado, e `astral_dbm` não é compartilhado com ninguém: o isolamento que o
schema `dbm` faria já vem do banco inteiro, mais forte e mais simples de raciocinar.

**Regra de integridade que vale para todas:** `usuario_id` → `dbm_usuario`,
`papel_id` → `dbm_papel`, `conexao_id` → `dbm_conexao`, todos com FK real e
`ON DELETE RESTRICT`. **Nunca `ON DELETE CASCADE` e nunca `SET NULL` em coluna de
auditoria** — cascade apaga a trilha junto com o usuário, e `SET NULL` transforma
"quem fez" em "não se sabe", que é exatamente o oposto do que a auditoria existe para
registrar. Usuário com trilha não se apaga: se desativar.

### 14.1 `dbm_usuario` e `dbm_papel` — perfil local, identidade emprestada

**A versão anterior desta subseção inventava um store de credenciais. Estava errado**, e
foi corrigido em 29/09 depois de ler a autenticação que o Astral já tem (§0.19). Ela
trazia `senha_hash` com bcrypt — um segundo sistema de senha dentro do mesmo
ecossistema, que é exatamente o que §0.19 existe para impedir.

**O que o DBM consome (§0.25):** o contrato do Auth Service, nativo, desde o início.
- **Identidade:** vem do Auth Service -- `identityId` e `username`. Não há senha no DBM.
- **Papéis:** vêm do campo `groups` do contrato. O DBM não os interpreta como
  autoridade: quem tem o que é o `dbm_papel` (§14.18), e um grupo que não esteja no
  catálogo não concede nada.
- **Provedores:** vêm do campo `provider`. O DBM **não implementa** AD, Postgres, Linux
  nem certificado — quem implementa é o Auth Service, e duplicar isso aqui está proibido.
- **Sessão:** do DBM, sobre o contrato. Nada de `HttpSession` do Astral nem de
  `changeSessionId()`: essa parte do modelo do Astral não é mais a dependência.

`dbm_usuario` — **perfil e preferência. Não é fonte de identidade e não autentica
ninguém.** `id, uuid, username, source TEXT, display_name, ultimo_acesso_em,
preferencias JSONB, created_at, updated_at`, `UNIQUE (lower(username))`.

**`source` é `TEXT` com vocabulário documentado, e não `CHECK` de dois valores** — a
mesma regra de `fonte` da §0.20.3. Medido em 30/09 no contrato do Auth Service (§0.25), os
valores de `provider` são `AD`, `LINUX`, `POSTGRES`, `CERTIFICADO`, e `source` espelha esse
vocabulário. O ponto da regra nunca foi a lista: foi a lista **não estar no schema**. Um
`CHECK (source IN ('AD','POSTGRES'))` rejeitaria um login legítimo, e o sintoma seria o
usuário existir na fonte e não ter perfil no DBM — um furo de segurança silencioso. É por
isso que `CERTIFICADO` entrou sem migration nenhuma, e é por isso que fonte nova entra sem
migration; ausência não entra (§0.22.3). A guarda da V100 que rejeita `source` virando enum
fechado continua sendo a razão de o DBM não quebrar quando a lista mudar de novo. A chave é
o **`username` que o contrato carrega** — não e-mail, não id interno.
preguiçosamente no primeiro acesso autenticado e guarda só o que o token não carrega:
nome de exibição, último acesso, preferências de UI. **Sem `senha_hash`, sem hash, sem
nada que pareça credencial.** Se a tabela inteira for apagada, ninguém é deslogado e
nada é invadido: ela volta no próximo acesso.

**O que é do usuário, para deixar explícito** (decisão do dono, 29/09): perfil, preferências, configuração
e layout. Layout, o estado dos painéis descrito em 3.1, que persiste por usuário, mora em
`preferencias JSONB` e **não** ganhou tabela: é estado de tela, com um dono e sem
consulta, e inventar `dbm_layout` para um documento por usuário seria modelar a interface
como entidade.

Favoritos e snippets **têm** tabela própria (`dbm_favorito` 14.6, `dbm_snippet` 14.7), com FK para
`dbm_usuario` e `UNIQUE` própria. Isso não é duplicação: o perfil guarda quem a pessoa é, e
o favorito é uma linha com nome, SQL, conexão de origem e escopo, consultável e compartilhável.
Favorito é registro, não atributo: a mesma distinção que matou o `favorite BOOLEAN` de
`dbm_historico_query` (0.18).

`dbm_papel` — **catálogo dos papéis que o DBM conhece, não concessor.** `id, uuid, nome,
descricao, origem (astral|configurado), created_at`, `UNIQUE (nome)`. Semeado a partir
dos papéis do Astral (§0.19.1). Serve para a UI exibir o nome legível e para
`dbm_permissao` mapear `papel_id` → permissões `dbm.*`. **Uma autoridade fora deste
catálogo não concede nada** — o default é negação, não permissão.

**`dbm_usuario_papel` não existe, e essa é a decisão.** Papel é fato da fonte de
identidade — hoje o `groups` do contrato do Auth Service (§0.25), e antes o AD ou o
Postgres. Tabela onde alguém inserisse `usuario_id`/`papel_id` seria um lugar que a
autenticação nunca lê, e cujo dono acharia que estava concedendo acesso. Conceder papel
é operação na fonte de identidade, onde vale de verdade — e o DBM não concede nenhum, nem
no banco do sistema nem no alvo (§0.7).

**Medido:** o `fabric/firewall` **não tem autenticação própria** — 0 ocorrências de
`SecurityFilterChain`, `AuthenticationProvider`, `Principal` ou `GrantedAuthority` no
módulo inteiro. O firewall herda a do Astral, e o DBM faz o mesmo.

### 14.2 `dbm_conexao`
Conexões registradas.
`id, uuid, grupo_id, nome, driver_id (→ `dbm_driver`), url, usuario_bd, senha_cifrada BYTEA,
esquema_padrao, criado_por, visivel_para, global BOOLEAN, somente_leitura BOOLEAN,
timeout_ms, linhas_max INT, max_linhas_exportacao INT, schemas_visiveis TEXT[],
objetos_visiveis TEXT[], descricao, ativo, ultimo_test_em, ultimo_test_status,
ultimo_test_erro, created_at, updated_at`.

- `usuario_bd` e não `usuario`: o login do **banco alvo**. Deixar como `usuario` ao
  lado de `criado_por` (usuário do **DBM**) em toda consulta é convite a bug, e a
  coluna é usada em tela. Colisão de nome corrigida aqui.
- `criado_por` (→ `dbm_usuario`) e `visivel_para` (→ `dbm_papel`) são o eixo de
  escopo, no lugar de `empresa_id` (§6.3).
- `UNIQUE (lower(nome))` — global, sem `empresa_id` na chave. Conexão é recurso
  compartilhado do produto; dois usuários que criem "produção" colidem, e é o
  comportamento correto: uma conexão duplicada é risco, não conveniência.
- `senha_cifrada` é `BYTEA` cifrado **pela aplicação**, com chave em variável de ambiente;
  ausência da chave impede o DBM de subir (§6.9). Sem extensão no banco do DBM (§0.24).
- **`driver_id` é FK para `dbm_driver`, e não `driver TEXT`.** O `UNIQUE` do catálogo
  é `(fabricante, versao)` e não `nome` (§14.20), porque duas versões do mesmo driver
  compartilham nome — então não dava para referenciar por nome, e texto livre é
  pior: aceitaria `"PostgreSQL 42.7.13"` sem conferência, a conexão seria salva e
  **só falharia ao abrir**. É a falha silenciosa da §0.20.3 em forma de coluna.

### 14.3 `dbm_grupo_conexao`
Pastas de ambiente (produção, homologação, desenvolvimento).
`id, uuid, nome, cor, ordem, criado_por, created_at`.

### 14.4 `dbm_sessao` e `dbm_sessao_historico`
Sessão de workbench — o porquê de Redis e não Postgres: é estado volátil e
descartável. Implementado em Redis (`dbm:wb:...`, §2.4 e §13.6). Se for preciso
persistir para auditar "quem ficou com transação aberta", a tabela é
`dbm_sessao_historico`: `id, usuario_id, papel, conexao_id, aberto_em, fechado_em,
transacao_aberta, sql_count`.

### 14.5 `dbm_historico_query`
`id, uuid, usuario_id, conexao_id, sql_text, sql_hash, norm_sql, titulo,
executado_em, duracao_ms, status, linhas, created_at`.
Índice `(usuario_id, executado_em DESC)` e `(conexao_id, executado_em DESC)`.

**Sem coluna `favorite`:** a versão anterior tinha `favorite BOOLEAN` aqui *e* a
tabela `dbm_favorito`. Dois lugares para o mesmo fato, e o que marcava o favorito
era o boolean, então favoritar e desfavoritar não deixavam rastro em lugar nenhum.
Favorito é registro, não flag: vive em `dbm_favorito` (14.6) e é só leitura aqui.

### 14.6 `dbm_favorito`
`id, uuid, usuario_id, nome, sql_text, conexao_id, escopo (pessoal|compartilhado),
descricao, created_at`. `UNIQUE (usuario_id, escopo, lower(nome))`.

O antigo `dbm_favorito_compartilhado` **deixou de existir**: ele existia só para
distinguir o favorito compartilhado *com a empresa*, e sem empresa o escopo é um
atributo do próprio favorito. Duas tabelas para um atributo é normalização
desfeita.

### 14.7 `dbm_snippet`
`id, uuid, usuario_id, nome, sql_text, descricao, linguagem,
escopo (pessoal|compartilhado), created_at`.

### 14.8 `dbm_auditoria` — substitui `bc_core_auditoria`
`id, uuid, usuario_id, papel, origem (usuario|job|evento|api), conexao_id,
objeto_tipo, objeto_nome, schema_nome, operacao, resultado (ok|falha|negado), erro,
antes JSONB, depois JSONB, ip, user_agent, duracao_ms, created_at`.

Guarda **quem** (`usuario_id`), **de qual papel**, **de qual origem**, quando, o que
foi afetado, o resultado, e `antes`/`depois` — o conjunto que `bc_core_auditoria`
tinha, sem `empresa_id` e sem `registro_id` (que é o que não cabe em SQL solto,
§7.3). Particionada mensalmente (§7.8).

### 14.9 `dbm_execucao`
Ver §7.3. Tabela central da auditoria de SQL. Índice `(conexao_id, created_at DESC)`,
`(sql_hash)`, `(usuario_id, created_at DESC)`, e parcial sobre falha.

### 14.10 `dbm_negativa`
`id, uuid, usuario_id, conexao_id, sql_text, motivo, regra, ip, created_at`.
`motivo` estruturado (`permissao`, `lista_negacao`, `timeout`, `conexao`,
`cancelamento`).

### 14.11 `dbm_backup`
Ver §7.5. Índice `(conexao_id, created_at DESC)`, `(verificado)`.

### 14.12 `dbm_job`
`id, uuid, usuario_id, conexao_id, tipo, estado (pendente|rodando|ok|falha|cancelado),
prioridade, payload JSONB, resultado JSONB, erro, tentativa, max_tentativas,
agendado_para, iniciado_em, concluido_em, created_at`.
Índice parcial `WHERE estado IN ('pendente','rodando')` para o worker pegar rápido.

### 14.13 `dbm_alerta_regra`
`id, uuid, nome, conexao_id, metrica, operador, limiar, janela_min, severidade,
canais JSONB, cooldown_min, criado_por, ativo, created_at`.

### 14.14 `dbm_alerta_evento`
`id, uuid, regra_id, conexao_id, metrica, valor, severidade, dispara_em,
resolve_em, notificado BOOLEAN`.

### 14.15 `dbm_metrica_serie` e `dbm_metrica_agregado`
Série: `id, conexao_id, metrica, bucket_ts, valor, medido_em, fonte, host, regiao`.
Agregado: `id, conexao_id, metrica, granularidade (hora|dia|mes), bucket_ts, min, max,
avg, p95, p99, amostras, medido_em, fonte`.
`UNIQUE (conexao_id, metrica, bucket_ts)`. Particionado por tempo.

`host` e `regiao` existem porque CPU e RAM **não são observáveis por JDBC** (§16.1):
quem preenche essas duas colunas é o agente no host, não o driver. É a única forma
de o Health Score ter esses fatores, e por isso eles são ausentes quando não há
agente — e a UI declara a cobertura (§0.17), em vez de fingir 7 de 7.

`fonte` e `medido_em` existem porque 0.17 exige `valor . cobertura . medido_em . fonte`
para todo valor, e a serie era a unica das duas tabelas que tinha so `valor` (0.20.3).
`fonte NOT NULL`, com `indisponivel` como valor reservado: quando a coleta nao roda, o
custo e uma linha com `fonte = indisponivel`, e nao um buraco que a UI le como zero.

### 14.16 `dbm_mudanca`
Change tracking: `id, uuid, conexao_id, objeto_tipo, objeto_nome, schema_nome,
operacao, usuario_id, origem (modulo|externo), sql_text, antes JSONB, depois JSONB,
created_at`.

**`conexao_id` é obrigatório e faltava:** a tabela guarda mudança de objeto *de um
banco administrado*, e sem a conexão não há como saber qual. Com o DBM administrando
vários bancos ao mesmo tempo, "a tabela `pedidos` foi alterada" sem dizer de qual banco
é informação inútil — e no caso do `astral` e do `brasil_saas` tem gente demais
homônima.

`origem='externo'` é preenchido pelo event trigger — é o que diferencia "o DBM mudou"
de "alguém mudou".

### 14.17 `dbm_migration` e `dbm_aprovacao`
Migration: `id, conexao_id, versao, descricao, caminho, checksum, sql_script,
sql_reverso, estado, aplicada_em, usuario_id, erro`.
Aprovação: `id, migration_id, solicitante_id, aprovador_id, estado, comentario,
solicitado_em, decidido_em`. `solicitante_id` e `aprovador_id` já dizem quem — a
`empresa_id` da versão anterior era redundante mesmo dentro do modelo antigo.

### 14.18 `dbm_permissao`, `dbm_permissao_escopo` e `dbm_execucao_permitida`
Permissão: `id, papel_id, permissao, escopo (conexao_id NULL = global), created_at`.
Escopo: `id, conexao_id, papel_id, schema_nome, tipo_objeto, nome_objeto,
pode_exportar, teto_linhas, created_at`. Recorte de quais schemas/objetos um papel
enxerga numa conexão. Quando o papel é Operador, materializa-se como `GRANT SELECT`
na role `dbm_operador` do banco alvo (§0.7) — o DBM declara, o banco aplica.
Função permitida: `id, papel_id, schema_nome, funcao, ativa, created_at`. Whitelist
de função por papel, default **vazia para leitura**: Somente Leitura só executa
função aqui liberada.

`papel` virou `papel_id` com FK para `dbm_papel`, e `schema` virou `schema_nome` — que é
como `dbm_mudanca` já chamava a mesma coisa. `schema` como nome de coluna é palavra
que o Postgres reserva contexto; `schema_nome` não obriga ninguém a aspas em todo SQL.

### 14.19 `dbm_configuracao`
Chave/valor, no `astral_dbm`. O `bc_core_configuracao` do ERP morreu como dependência
pelo mesmo motivo da auditoria (§7.1): está em outro banco.
`id, chave UNIQUE, valor, tipo, descricao, updated_por, updated_at`.
Chaves: `dbm.linhas_max`, `dbm.timeout_leitura_ms`, `dbm.transacao_timeout_ms`,
`dbm.retener_auditoria_meses`, `dbm.allow_risco`.

Quem consome, e em que tela (§0.21.2): `dbm.linhas_max` e os dois timeouts são
lidos pelo `editor` e aparecem em **Conexões > Editar conexão** e na barra do editor
(§3.1); `dbm.retener_auditoria_meses` é lido por `auditoria` e muda em **Auditoria >
Retenção e política**; `dbm.allow_risco` é lido por `inteligencia` e muda em
**Inteligência > Analisador de Query**. Nenhuma das cinco é editável de tela que não
é a dela — chave de configuração sem tela dona é o furo que a §0.21.1.

### 14.20 `dbm_driver` — catálogo de drivers (JDBC-first)
`id, uuid, nome, fabricante, versao, jdbc_class, jdbc_url_template, download_url,
checksum_sha256, assinatura, ativo, suportado_nivel (COMPATIVEL|SUPORTADO|CERTIFICADO),
cache_path, tamanho_bytes, baixado_em, verificado_em, erro_verificacao, created_at,
updated_at`

Único por `(fabricante, versao)`. `download_url` aponta para o artefato oficial do
fabricante (Maven Central ou site do fornecedor); `checksum_sha256` é conferido no
download e o registro só fica `verificado` quando bate. Cache em
`dbm/drivers/<fabricante>/<versao>/` — **no servidor**, nunca no navegador (§0.11) —
carregado com classloader isolado por driver.

### 14.21 `dbm_score` — os seis indicadores como registro, não como número

`dbm_score` é a tabela que §0.17 sempre pressupôs e que nunca existiu (§0.20.3). Guarda **os
seis indicadores em uma tabela só**, discriminados por `tipo`:

`id, uuid, conexao_id, tipo (health|query_risk|aci|utilidade_indices|previsao_crescimento|anomalias),
valor, cobertura, medido_em, fonte, fatores JSONB, created_at`.
`UNIQUE (conexao_id, tipo, medido_em)`. Índice `(tipo, medido_em DESC)` para o ranking.

Os quatro campos da regra de §0.17 são **colunas**, e `NOT NULL` nos que podem silenciosamente
faltar. `fonte` é `TEXT` com vocabulário documentado (`pg_stat_statements`, `pg_catalog`,
`information_schema`, `agente_host`, `sistema`, `indisponivel`), e `indisponivel` é reservado:
fonte nova pode entrar, ausência não.

`fatores JSONB` guarda o detalhamento por fator, e cada fator carrega o **seu** `fonte` e o
**seu** `medido_em`, porque a cobertura é declarada por fator (§0.17), e um fator que veio de
fonte indisponível tem de ser distinguível de um fator que veio de fonte boa com valor ruim. A
linha é o resumo; o `fatores` é o que permite contestar o resumo.

**Por que uma tabela e não seis.** Os seis têm contrato idêntico, são lidos juntos na tela, e
só são comparáveis dentro do mesmo `tipo`. Seis tabelas seriam seis cópias das mesmas colunas.
O custo é o `tipo` ser `CHECK` e não tabela própria, e eu aceito: o contrato dos quatro campos
é o que precisa ser garantido, e coluna com `NOT NULL` garante. O que não seria aceitável é
score sem `fonte` e sem `cobertura`, e é exatamente isso que a coluna impede.

**Regra de leitura, e é ela que segura a comparação:** score com cobertura parcial não entra em
ranking. Com `cobertura` e `fonte` em coluna, o filtro é um `WHERE` e não um cuidado da tela, e
é por isso que a coluna existe, e não por causa decorativa.

### 14.22 Integração com o ERP e com o Astral
As tabelas `dbm_*` **não** vivem no schema do ERP, e o ERP não lê por view. Como cada
projeto tem seu banco (§0.14), a integração é por **evento**, não por tabela
compartilhada:

- DBM publica em `astral.eventos` (§13.5) e o ERP consome.
- O ERP lê o estado do DBM por **API**, nunca por conexão direta ao banco dele.
- Nenhuma dependência de código entre os dois, em direção nenhuma, por `ApiResponse`,
  filtro de empresa ou tabela compartilhada. Se o DBM precisar de dado do ERP algum dia,
  isso vira pergunta de API com dono — não uma `SELECT` atravessando banco.

---

## 15. Entrega, riscos e o que medir primeiro

### 15.1 Ordem sugerida

O corte da V100 está fechado em §13.10; esta ordem diz como as fases se
encadeiam depois dela.

1. **Conexões + árvore + SQL editor com leitura** — já entrega o uso diário.
2. **Auditoria de execução + negativa + limites** — antes de qualquer escrita.
3. **Escrita com transação manual, confirmação e DDL** — o passo de maior risco, e vai depois
   da trilha existir.
4. **Objetos (colunas, índices, constraints, triggers, policies)** e designers.
5. **Jobs e backup/restore** — precisa de fila e de verificação.
6. **Monitoramento, alertas, top queries** — precisa de `pg_stat_statements`.
7. **Enterprise: diff, migrações, deploy, aprovação**.
8. **Firebird/InterBase**, se o dono decidir (§0.3).

### 15.2 Riscos que precisam de resposta explícita

| Risco | Mitigação |
|---|---|
| Ferramenta derruba banco | Leitura padrão, escrita atrás de permissão, confirmação digitada, backup verificado antes de `DROP`, sem auto-commit |
| Vazamento de credencial | Cifra em repouso, nunca retorna ao browser, `dbm.credentials.read` auditado |
| Trilha de auditoria que é só auto-relato | Event trigger + selo de cobertura parcial quando ausente |
| Auditoria que custa caro | Partições, retenção, regra de 5% |
| Diff destrutivo sem querer | Detecção de operação com perda de dado, aviso e backup sugerido |
| Cache servindo catálogo velho | Invalidação por DDL + `updated_at` + TTL |
| Módulo como carga do banco | Métricas coletadas por job, cache, teto de linhas, `statement_timeout` |
| Dois donos no mesmo lock | Locks em Redis, não em memória |
| Fila que perde job | Idempotência, DLQ com alerta, registro em `dbm_job` |

### 15.3 O que medir antes de escrever qualquer linha de backend

Sem isto, a especificação vira chute. Medir no Postgres real da máquina:

1. `pg_stat_statements` está instalado? Não está (medido: não aparece nas migrações).
2. Qual `max_connections`, `shared_buffers`, `work_mem`? O que a definição de pool do módulo
   deveria respeitar.
3. Tem `log_min_duration_statement` configurado? Sem isso, análise de query lenta é adivinhação.
4. Tem banco de staging para testar `DROP`, `restore` e migração? **Sem staging, backup não
   verificado e restore não são testáveis** — e o botão de restore é o mais perigoso do
   módulo.
5. Existe `pg_repack` ou alguma forma de shrink sem janela? §4.5 promete shrink.

### 15.4 Definition of done do módulo

- [ ] Toda leitura de caminho padrão funciona com o banco do ERP como alvo.
- [ ] `SELECT` roda sem permissão de escrita e sem transação de escrita.
- [ ] `CREATE`/`DROP` exigem permissão, confirmação digitada, e deixam rastro com SQL, usuário,
      IP e antes/depois.
- [ ] A lista de negação (§6.7) barra cada caso, **e** o bypass auditado funciona.
- [ ] Backups saem verificados; restore recusado sem backup verificado.
- [ ] Cronômetro e lock funcionam em múltiplas abas, em múltiplas instâncias.
- [ ] Migrar o schema de um banco a outro gera script executável de ponta a ponta.
- [ ] Nenhuma senha de conexão aparece em log, resposta de API, export ou histórico.
- [ ] Roda em duas instâncias atrás do Nginx sem duplicar job nem liberar lock duplicado.


## 16. Camada de inteligência Astral

Seção nova (29/09), por decisão do dono. É a parte do produto que não é cópia: a árvore
de objetos todo gerenciador tem; o que ninguém tem é o DBM respondendo **qual banco está
pior, qual query é mais perigosa, qual índice é desperdício, qual banco vai lotar primeiro
e se dá para confiar naquele banco agora.**

Lê o princípio primeiro, porque vale para os seis: §0.17 — **nenhum score aparece sem
`valor · cobertura · medido_em · fonte`**, e cobertura é declarada por fator.

### 16.1 Astral Health Score (0–100)

Sete fatores, cada um com a fonte que o produz e o que acontece quando a fonte não
existe:

| # | Fator | Fonte | Cobertura quando falta |
|---|---|---|---|
| 1 | Carga de CPU | **não é JDBC** — precisa de agente no host | fator ausente |
| 2 | Pressão de memória | **não é JDBC** | fator ausente |
| 3 | Locks ativos | `pg_locks` / catálogo do fabricante | 3 de 3 cai para "consulta" |
| 4 | Deadlocks | catálogo do fabricante | fator ausente |
| 5 | Queries lentas | `pg_stat_statements` | **sem ele, 1 de 5** |
| 6 | Latência de I/O | `pg_stat_database` / fabricante | degradado |
| 7 | Estado da réplica | `pg_stat_replication` / fabricante | fator ausente |

**Medido nesta máquina:** `pg_stat_statements` **não está instalado** e exige reinício
para entrar. Então, no PostgreSQL daqui, o fator 5 é indisponível e o Health Score sai
com 6 de 7 — e a UI tem que mostrar "6 de 7", senão estáafirmando o que não mediu.

**A regra que impede a comparação falsa, e ela é a mais importante desta subseção:**
**dois bancos com coberturas diferentes não são comparáveis.** "Postgres 92, MySQL 78"
pode ser inteiramente artefato de cobertura, não de saúde. Então:

- com **cobertura 7/7**, o score é exibido e participates do ranking;
- com **cobertura parcial**, o score é exibido com o selo de parcial e **nunca entra no
  ranking**;
- o ranking só compara bancos com a mesma cobertura.

Faixas: **0–69 crítico · 70–89 em atenção · 90–100 saudável**. Faixa sem cobertura é
"indisponível", nunca "saudável" por omissão.

### 16.2 Astral Query Risk (0–100) — calculado **antes** de executar

O exemplo do dono é `DELETE FROM pedidos` → risco 97/100. O que é honesto nesse exemplo
e o que não é:

**Sabível antes de executar (observável por JDBC ou pelo executor do módulo):**

- tipo do comando: `SELECT` / `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` / DDL;
- presença e simplicidade do `WHERE` (ausente em `DELETE`/`UPDATE` é o fator que mais
  pesa);
- tabelas atingidas e o **tamanho** delas;
- se a coluna do predicado tem índice;
- se a conexão está em transação e se há `autocommit` desligado;
- `statement_timeout` configurado (§0.2);
- veredito da lista de negação §6.7;
- histórico do usuário com aquele comando naquela conexão.

**Não sabível antes de executar, e o módulo não pode fingir que sabe:**

- **quantas linhas o `WHERE` vai atingir.** JDBC não tem API de seletividade. Só há
  caminho honesto: o **estimador do SGBD** — `EXPLAIN` no PostgreSQL — que é justamente
  o que §0.5 restringe ao adaptador, e que exige privilégio e é estimativa, não verdade.
- quantos locks a operação vai pegar, e quanto tempo vai levar.

Então o Query Risk é **soma ponderada de fatores observáveis, rotulada como estimativa**,
com a base declarada (`fonte = catálogos + statistics server`, não `EXPLAIN`). Para
`DELETE FROM pedidos` sem `WHERE` numa tabela grande e fora de transação, 97/100 é
plausível — e o número aparece acompanhado de **quais fatores o levantaram**, senão é
slogan.

**Regra que não pode ser furada:** o score **nunca autoriza e nunca substitui a lista de
negação da §6.7.** Risco baixo não é permissão; é informação. Autorização é a §6.7 e a
§12.8, e ponto.

### 16.3 ACI — Astral Confidence Index (%)

Seis fatores, respondendo a "posso confiar neste banco agora?":

| Fator | Peso | Observado como |
|---|---|---|
| Integridade | 25 | `pg_amcheck` (Postgres) ou equivalente de fabricante — **não é JDBC** |
| Backup verificado | 25 | **só o que o DBM verificou ele mesmo** (§15.3 exige staging) |
| Réplica | 15 | lagging, quando há réplica |
| Health Score | 15 | §16.1 |
| Auditoria | 10 | §7, e o selo de cobertura parcial |
| Latência | 10 | I/O e tempo de resposta |

Pesos declarados como **escolha, não medição**: integridade e backup somam metade porque
confiança em banco é, no fundo, "se isto sumir, eu volto?".

**A regra que decide o comportamento quando falta um fator — e é contra-intuitiva, por
isso está escrita:** fator ausente **não é neutro, é um teto**. Não se pode computar
`ACI = 100` porque "de backup eu não sei". Não havendo staging (hoje é o caso, §15.3), o
backup verificado entra com **0**, não com "neutralizado". O ACI é apresentado como
**limite inferior** sempre que algum fator-critical está ausente:

```
ACI  94%  (6 de 6 fatores)
ACI  62%  (5 de 6 |  limite inferior: backup não verificado, não há staging — §15.3)
```

Nunca um número redondo sem o carimbo. É a diferença entre informar e decorar.

### 16.4 Índice de Utilidade de Índices

Pergunta: qual índice é desperdício. O exemplo do dono é `IDX_CLIENTE_CPF`, uso 0,
400 MB, score 1/100, candidato à remoção. A fórmula é razoável. **Três correções de
segurança, e as três são obrigatórias:**

1. **Índice único e chave primária NUNCA é candidato.** `IDX_CLIENTE_CPF` pode ser
   `UNIQUE` — e aí ele não é desperdício, é a Constraint de unicidade do banco, e
   derrubá-lo é perder a garantia. O score tem de zerar para qualquer índice que
   sustente PK, UNIQUE ou FK.

2. **"Uso 0" só vale dentro de uma janela declarada, e a janela tem que conter um reset
   de estatística.** Sem `pg_stat_reset_stats()` (ou equivalente) na janela, "0" pode
   significar "nunca se mediu" em vez de "nunca se usou". A janela mínima recomendada é
   **30 dias com reset declarado**, e ela aparece na tela junto do score.

3. **Remoção é sugestão, com o comando pronto e o risco escrito.** A tela mostra o
   `DROP INDEX` e o que acontece se alguém estiver usando no meio do caminho — mas não
   executa. Fora do bypass auditado da §6.7, isto aqui nem entra.

Score: combina uso (0–50), tamanho (0–25) e custo de escrita que o índice impõe
(0–25, mais índice, mais custo em cada `INSERT`/`UPDATE`). Índice pequeno, muito usado e
único: score alto, e a tela diz **manter** — o indicador também diz o que não deve cair.

### 16.5 Previsão de Crescimento

Regressão linear sobre a série de tamanho, com projeção para 30/90/180 dias. O dono
acertou no método; o que falta para não mentir é o resto:

- **Mínimo de amostras: 14 diários.** Abaixo disso não projeta: responde "dados
  insuficientes, 4 de 14 amostras".
- **O R² da regressão é exibido junto da projeção.** R² baixo significa que a reta não
  descreve os dados, e uma projeção de 180 dias com R² = 0,3 é especulação. A tela
  mostra `R² = 0,97` ao lado de `180 dias: 640 GB` — e quando o R² é baixo, a projeção
  vem marcada como não confiável.
- **"Qual banco vai lotar primeiro" exige capacidade, e capacidade não é JDBC.** O
  driver não lê disco livre do host. Então: o módulo projeta **taxa e tamanho**, e só
  responde "lotar" se souber o total — seja de um agente no host (§0.5), seja do que o
  dono registrar como capacidade. Sem isso, ele responde a pergunta que ele consegue.

### 16.6 Detecção de anomalias

Média móvel + desvio padrão + Z-score, sobre séries que o DBM já coletou: consultas, locks,
conexões, lagging de réplica, deadlocks. Z limiar declarado (|z| > 3).

**A correção semântica que faz a diferença entre sinal e alarme falso:** o que se detecta
é **anomalia em relação ao histórico recente daquele banco**, não em relação a um valor
absoluto. Manutenção semanal, relatório mensal e rotina de backup produzem picos
perfeitamente previsíveis; contra um limiar absoluto, todo DBA recebe falso positivo toda
semana e para de ler. Comparado ao próprio histórico, o mesmo pico pode ser normal, e o
que interessa é a mudança de padrão.

E cada alerta mostra **por que foi marcado**: valor, média da janela, desvio, z e janela
usada. Anomalia sem justificativa visível é alarme que se aprende a ignorar.

### 16.7 Volume, retenção e ordem de entrega

Séries de métricas moram em `astral_dbm` (§0.16.1). Retenção: **90 dias horários**,
depois agregado por dia, depois por mês. É dado que cresce sozinho e o banco do DBM tem
que ter backup próprio — senão o backup do DBM engole o backup do DBM, que é a pior
forma de crescimento.

| Indicador | Depende de | Pode sair na | Bloqueio real |
|---|---|---|---|
| Query Risk | catálogos + statistics | `dbm-v100-alpha` | estimate, não verdade (§16.2) |
| Índice de Utilidade | `pg_stat_user_indexes` | `dbm-v101` | janela de 30 dias |
| Health Score | §16.1 | `dbm-v101` | CPU/RAM precisam de agente |
| Anomalias | série própria | `dbm-v101` | 14 amostras |
| Previsão | série própria | `dbm-v101` | 14 amostras e R² |
| ACI | os 5 anteriores | `dbm-v102` | backup verificado depende de staging (§15.3) |

O ACI é o último de propósito: ele é o mais prometido e o que mais depende de ambiente
real. Declarar ACI antes de ter staging seria o "100% falsa" que a §0.3 e a §0.8 já
proibiram.
