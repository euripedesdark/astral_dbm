# Astral DBM — Astral Database Manager

Gerenciador de bancos web, no estilo **IBConsole (Interbase)**: árvore de objetos
à esquerda, grade de dados, estrutura e console SQL. Produto **separado** do
Astral Platform (spec §0.14/§0.16) — este repositório contém a especificação, a
migração inicial e o **código do produto**.

- Especificação funcional e arquitetural: [`docs/ASTRAL-DATABASE-MANAGER.md`](docs/ASTRAL-DATABASE-MANAGER.md)
- Migração do banco próprio: [`src/main/resources/db/migration/V100__dbm_inicial.sql`](src/main/resources/db/migration/V100__dbm_inicial.sql)
- Verificador do mapa de tabelas/telas: [`docs/dbm/verifica_mapa.py`](docs/dbm/verifica_mapa.py)

## Stack (mesma do Brasil SaaS ERP)

| Camada | Tecnologia |
|---|---|
| Backend | Java 21, Spring Boot 3.3.5, Maven, Spring JDBC, Flyway, Spring Security |
| Frontend | React 19, PrimeReact 10, PrimeIcons, Vite 5 |
| Banco próprio | PostgreSQL (`astral_dbm`, schema `public`, prefixo `dbm_`) |
| Bancos-alvo | JDBC dinâmico (PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, H2) |

## Arquitetura

```
┌─────────────────────────────┐        JDBC (pool por conexão)
│  React (static/react)       │
│  Explorer · Dados ·         │
│  Estrutura · Bancos · SQL   │
└──────────────┬──────────────┘
               │ REST /api
┌──────────────▼──────────────┐      ┌──────────────────────────┐
│  Spring Boot (astral-dbm)   │─────▶│  Bancos-alvo cadastrados │
│  conexao/ explorer/ query/  │      └──────────────────────────┘
│  auditoria/ pool/ crypto/   │
└──────────────┬──────────────┘
               │ Flyway
┌──────────────▼──────────────┐
│  PostgreSQL — banco         │
│  próprio `astral_dbm`       │
└─────────────────────────────┘
```

O banco do DBM guarda **metadados** (conexões, drivers, histórico, auditoria).
Os dados de negócio vivem nos bancos-alvo, acessados por pool JDBC em memória
no servidor (spec §0.11 — o cache é recurso do servidor, nunca do navegador).

## Como rodar

### 1. Criar o banco próprio

```bash
sudo -u postgres psql -f dev/criar-banco.sql
```

Cria o banco `astral_dbm` e o usuário `astral_dbm`. As tabelas são criadas pelo
Flyway na subida da aplicação.

### 2. Subir o backend

```bash
mvn spring-boot:run
# http://localhost:8091
```

Variáveis de ambiente (com defaults de desenvolvimento):

| Variável | Default |
|---|---|
| `DBM_DB_URL` | `jdbc:postgresql://127.0.0.1:5432/astral_dbm` |
| `DBM_DB_USER` | `astral_dbm` |
| `DBM_DB_PASSWORD` | `astral_dbm` |
| `DBM_CIFRA_CHAVE` | *(efêmera; defina Base64 de 32 bytes em produção)* |

> `DBM_CIFRA_CHAVE` cifra a senha dos bancos-alvo (AES-GCM). Sem ela, as senhas
> não sobrevivem a um restart — o aviso aparece no log.

### 3. Frontend em desenvolvimento

```bash
cd src/main/resources/static/react
npm install
npm run dev        # http://localhost:5173, proxy /api -> :8091
```

Build de produção (gera `src/main/resources/static/dist`, servido pelo Spring):

```bash
npm run build
```

## O que já está implementado nesta base

- **Conexões** — CRUD, teste de conexão, grupos, modo somente-leitura, timeout.
- **Interface estilo IBConsole** — barra de menus (Conexões / Banco / Objeto /
  Ferramentas / Ajuda) com ações e atalhos, além de **barra de status** (conexão,
  driver, modo de acesso e URL) no rodapé.
- **Explorer (estilo IBConsole)** — árvore por schema com **Tabelas, Views,
  Sequências, Funções, Triggers, Tipos e Extensões**, contadores por grupo,
  filtro em memória e **menu de contexto** (botão direito): abrir dados,
  ver estrutura, ver DDL e copiar nome.
- **Dados** — browse paginado estilo IBConsole, busca ILIKE.
- **Estrutura** — colunas, chaves, índices e chaves estrangeiras.
- **Bancos / Schemas** — lista de bancos do servidor (dono, codificação, tamanho),
  criar banco (com preview do SQL), drop database e criar/dropar schema.
  DROP exige **confirmação digitando o nome** e é recusado em conexão
  somente-leitura (§4.1/§4.2).
- **DDL de objeto** — "Ver DDL" na Estrutura e no menu de contexto do Explorer:
  `CREATE TABLE` reconstruído a partir do catálogo (sequences, colunas,
  restrições e índices), `CREATE OR REPLACE VIEW`, `CREATE SEQUENCE`,
  `CREATE FUNCTION` e `CREATE TRIGGER` (§10.3). O DDL de tabela é
  autossuficiente — aplicado num banco novo, recria o objeto.
- **Console SQL** — execução multi-instrução, grade de resultado e
  **confirmação obrigatória para escrita** (defesa em profundidade, §0.7).
- **Auditoria** — trilha de SQL e DDL em `dbm_execucao` (best-effort).
- **Cifra** — senha do alvo em AES-GCM, nunca em claro na API.

## Próximos passos (da especificação)

Menus de Objetos (designer), Rotinas, Backup/Restore, Ferramentas DBA,
Inteligência (Query Risk) e Segurança/RBAC (§0.19, §13.8). A autenticação de
produção é o token do Astral — o ponto de extensão está em
`config/SecurityConfig.java`.