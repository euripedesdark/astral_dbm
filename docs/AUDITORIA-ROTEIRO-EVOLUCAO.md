# Auditoria inicial e roteiro de evolução — Astral Database Manager

Data: 2026-10-11  
Branch: `audit/roadmap-interbase`

## Objetivo do produto

Construir um gerenciador SQL web com experiência inspirada no InterBase/IBConsole: conexão rápida, árvore de objetos, edição de dados, estrutura/DDL, editor SQL e ferramentas de administração. A conectividade deve seguir JDBC-first, enquanto recursos específicos de cada SGBD ficam em adaptadores de capacidades. O produto não deve ser reescrito do zero: a base atual é o ponto de partida.

## Estado observado no código do repositório

A revisão foi estática, com leitura do README, especificação, `pom.xml`, migração V100, `App.jsx`, `QueryController.java` e `SecurityConfig.java`. Não foi executado build nem teste neste ambiente; portanto, isto não é uma certificação funcional.

Já presentes na documentação e/ou estrutura do código:
- Backend Java 21 / Spring Boot 3.3.5, JDBC, Spring Security e Flyway.
- Frontend React 19, PrimeReact 10 e Vite 5.
- UI principal com conexões, Explorer, Dados, Estrutura, Bancos e SQL.
- Endpoints para conexão, catálogo e execução SQL.
- Banco interno próprio `astral_dbm`, migração inicial V100 e catálogo de drivers.
- Diretrizes explícitas para cifra de credenciais, auditoria, leitura por padrão, confirmação de escrita e isolamento do banco interno.

## Riscos e lacunas prioritárias identificados

### P0 — Segurança antes de disponibilizar em rede
1. Em `SecurityConfig.java`, `dbm.auth.enabled` pode deixar a API inteira sem autenticação quando desativado. O default e o comportamento do perfil de produção precisam ser fail-closed: produção não deve subir publicamente com autenticação desligada. Incluir teste de configuração para ambos os modos.
2. A especificação exige autorização por permissões `dbm.*`, identidade do Astral e matriz de papéis. Confirmar em cada controller/service que autorização é aplicada no servidor, e não apenas na interface.
3. O endpoint de execução SQL recebe texto arbitrário. Validar no serviço o estado de leitura/escrita, confirmação explícita, limites de tempo/linhas, transação, cancelamento, classificação SQL e auditoria. Não confiar em classificação simplista por primeira palavra; CTEs, comentários e múltiplas instruções precisam de tratamento seguro.
4. O requisito de transação explícita e ausência de COMMIT automático deve ser demonstrado por testes de integração por driver/capacidade. Operações que não aceitam transação precisam ser identificadas e bloqueadas/avisadas.
5. Garantir que senha e material de conexão nunca retornem nos DTOs, logs, erros ou histórico; chave de cifra deve ser obrigatória em produção e não pode ser efêmera.
6. Garantir proteção contra SSRF/uso indevido do host:porta no cadastro de conexão, incluindo acesso a loopback, metadata endpoints e redes internas não autorizadas, conforme modelo de implantação.

### P1 — Fluxo central do DBM
1. Criar matriz rastreável recurso → endpoint → service → componente de UI → teste.
2. Verificar CRUD completo de conexões e grupos, teste de conexão, reconexão, desconexão e estados de erro/timeouts.
3. Implementar/validar cache e invalidação da árvore de metadados; busca por schema/objeto; refresh explícito; carregamento sob demanda sem consultas excessivas.
4. Confirmar paginação real no servidor, ordenação e filtros parametrizados na grade de dados; nunca concatenar valores de filtro sem parametrização.
5. Completar editor SQL com múltiplas abas/histórico/favoritos, parâmetros, resultados grandes em streaming ou paginação, cancelamento, mensagens de erro com posição e exportação controlada por papel.
6. Implementar operações de edição de linha com chave primária identificada, tratamento de tabelas sem chave e confirmação de gravação.
7. Completar DDL reverso e designer de objetos, com preview, diff e confirmação para alterações destrutivas.

### P1 — Drivers e suporte real a SGBDs
1. Driver Manager precisa de catálogo confiável, versões fixadas, download no servidor, checksum obrigatório, origem confiável, cache, classloader isolado e política de atualização/rollback.
2. Não marcar um driver como verificado/certificado apenas porque conectou. Separar níveis de compatibilidade, suporte e certificação.
3. Criar matriz de testes para PostgreSQL, Firebird e InterBase como primeiros SGBDs certificados; adicionar testes de compatibilidade JDBC genérica para outros drivers.
4. Dialetos/adaptadores devem anunciar capacidades explicitamente (Explain, locks, backup/restore, jobs, replication, tablespaces), com a UI escondendo/desabilitando funções não suportadas.
5. Validar templates JDBC e impedir que parâmetros de conexão sensíveis sejam expostos.

### P1 — Administração, segurança e auditoria
1. Auditoria append-only com ator, conexão, alvo, SQL normalizado/mascarado quando aplicável, resultado, duração, linhas afetadas, origem e correlação.
2. Diferenciar auditoria do que passa pela aplicação e eventos capturados no próprio banco; não declarar cobertura completa sem instalar/verificar o mecanismo no SGBD.
3. RBAC testado em nível de API para leitura, operador e DBA; exportação e limite de linhas conforme papel.
4. Backup/restore só deve aparecer quando o adaptador oferecer suporte real e existir ambiente de staging validado. Restore em produção deve ter controles adicionais.
5. Implementar sessões/locks/diagnóstico com consultas específicas por adaptador e permissões mínimas.

### P2 — UX responsiva e produtividade
1. Preservar a metáfora de IBConsole: árvore lateral, área de trabalho central com abas, console inferior/opcional, barra de status e menus contextuais.
2. Responsividade real: em telas estreitas, Explorer vira drawer; tabelas têm colunas configuráveis; ações não dependem exclusivamente de botão direito; atalhos têm alternativa visível.
3. Estados de carregamento, vazio, erro, desconectado e sem permissão devem ser consistentes; evitar falhas silenciosas.
4. Adicionar tema claro/escuro, densidade da grade, tamanho de fonte e preferências persistidas no perfil.
5. Melhorar acessibilidade: foco de teclado, labels, contraste, mensagens anunciadas e confirmação clara para operações destrutivas.

### P2 — Entrega e operação
1. CI deve executar testes Maven, build frontend, verificação de dependências, análise estática e testes de segurança.
2. Testes de integração com PostgreSQL em pipeline; testes Firebird/InterBase em job próprio quando o ambiente estiver disponível.
3. Health/readiness, métricas, logs estruturados com segredos removidos, timeouts e shutdown limpo.
4. Documentar deploy, variáveis obrigatórias, rotação da chave de cifra, backup do banco interno e recuperação.
5. Verificar que o Flyway V100 está no classpath correto do produto independente e nunca migra acidentalmente o banco do Astral Platform.

## Sequência sugerida de implementação

1. **Gate de segurança**: configuração fail-closed em produção, matriz de autorização, cifra obrigatória, limites de SQL e testes.
2. **Baseline automatizado**: compilar backend/frontend, inventariar endpoints/componentes e criar testes que reproduzam o comportamento existente.
3. **Workbench**: estabilizar conexão → Explorer → estrutura/dados → editor SQL, com paginação, erros e estados de interface.
4. **Driver Manager**: catálogo, verificação de integridade e carregamento isolado, com telemetria.
5. **InterBase/Firebird**: adapter de capacidades e suíte de certificação real.
6. **DBA**: explain/locks/sessões, DDL designer, backup/restore com staging e auditoria.
7. **Polimento e release**: responsividade, acessibilidade, documentação e CI/CD.

## Critérios de aceite mínimos

- Build de backend e frontend verde no CI.
- Testes de segurança demonstram negação sem token em produção e negação por falta de permissão.
- Nenhuma senha ou chave aparece em respostas HTTP ou logs.
- Uma conexão nova inicia somente leitura; escrita exige habilitação explícita, confirmação e auditoria.
- SQL com timeout excedido é interrompido no servidor; limites de linhas/exportação são aplicados no servidor.
- Fluxo de conexão, navegação, dados, estrutura, DDL e SQL coberto por testes.
- Capacidades indisponíveis em um SGBD não são apresentadas como disponíveis.
- Backup/restore não pode ser ativado sem staging validado.

## Limites desta auditoria

Este documento registra uma primeira leitura estática. Antes de declarar qualquer item como defeito confirmado, executar build, testes, inspeção completa de serviços/controllers e testes de integração. A especificação existente continua sendo fonte de requisitos; divergências devem ser resolvidas explicitamente, não por remoção silenciosa de requisitos.
