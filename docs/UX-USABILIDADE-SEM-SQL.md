# Diretrizes de usabilidade — Astral DBM

## Objetivo

Permitir que pessoas com pouca experiência em SQL consigam explorar, consultar e realizar alterações comuns com segurança. O Astral DBM deve manter o console SQL para especialistas, mas não pode exigir SQL para tarefas cotidianas.

## Princípios obrigatórios

1. **A interface é a primeira opção; SQL é a opção avançada.** Operações comuns devem ter formulários, botões claros, seletores e assistentes. O usuário pode abrir o SQL quando quiser, sem que ele seja obrigatório.
2. **Usar linguagem de negócio e explicar o impacto.** Preferir “Adicionar coluna”, “Editar registro”, “Criar tabela” e “Salvar alterações” a termos técnicos isolados. Quando um termo técnico for inevitável, explicar com texto de ajuda.
3. **Mostrar antes de alterar.** Exibir uma prévia legível da mudança, os objetos/linhas afetados e o SQL gerado, quando aplicável, antes da confirmação.
4. **Confirmação proporcional ao risco.** Edição simples de célula: confirmar ao salvar, com opção de cancelar. Alterações em massa, exclusões, DDL e operações destrutivas: resumo do impacto e confirmação explícita. Nunca esconder efeitos colaterais.
5. **Nunca fingir que uma alteração foi salva.** Mostrar estados carregando, sucesso ou erro; manter o formulário e os valores em caso de falha; explicar a causa em linguagem clara e oferecer próximo passo.
6. **Credenciais explícitas por conexão.** Ao conectar, apresentar o usuário do banco e solicitar a senha quando necessária. Não confundir login no aplicativo com autenticação do SGBD. Não registrar senhas em logs, mensagens ou auditoria.
7. **Descoberta guiada.** Na primeira utilização, apresentar passos curtos: escolher conexão, abrir tabela, consultar dados, editar e salvar. Exibir exemplos e estados vazios úteis.
8. **Responsivo e acessível.** Suportar teclado, foco visível, rótulos associados aos campos, contraste adequado, mensagens não dependentes apenas de cor e layouts utilizáveis em telas menores.
9. **Prevenir erros sem bloquear usuários experientes.** Validar campos, indicar obrigatoriedade, sugerir tipos e valores, permitir desfazer/cancelar alterações ainda não confirmadas e preservar o console SQL avançado.
10. **Padrões consistentes.** Ações primárias sempre no mesmo local; nomes e ícones consistentes; botões destrutivos separados das ações comuns; filtros, paginação e ordenação previsíveis.

## Fluxos prioritários sem SQL

### 1. Conectar a um banco

- Escolher uma conexão salva ou criar uma conexão.
- Informar host, porta, banco/serviço, usuário e senha em campos contextuais ao driver.
- Botão “Testar conexão” separado de “Conectar”.
- Mostrar erro acionável: host inacessível, credenciais recusadas, banco inexistente, driver ausente ou certificado inválido, quando possível.
- Oferecer opção de manter a senha salva de forma protegida; nunca presumir consentimento.

### 2. Explorar e localizar dados

- Navegador de bancos, schemas, tabelas e views.
- Busca por nome e filtros; favoritos e histórico recente.
- Ao abrir tabela, mostrar estrutura e dados em abas distintas.
- Paginação no servidor, ordenação e filtros por coluna com operadores e valores tipados.
- Exibir contagem como estimativa quando não houver contagem exata.

### 3. Editar registros

- Ação “Editar” por linha, com formulário tipado; edição em grade como opção.
- Diferenciar NULL de texto vazio e permitir escolher NULL explicitamente.
- Validar tipos, tamanho, obrigatoriedade, chaves e restrições antes de salvar.
- Mostrar valores anteriores e novos numa prévia; permitir cancelar.
- Se não existir chave primária ou identificador seguro, desabilitar edição automática e explicar por quê.
- Para exclusão, exibir o registro identificado e exigir confirmação clara.
- Nunca executar atualização ou exclusão sem um predicado de identificação seguro.

### 4. Criar e modificar estrutura

- Assistente visual para criar tabela, coluna, chave primária, relacionamento e índice.
- Seletores para tipo, tamanho, nulabilidade, valor padrão e restrições.
- Mostrar DDL gerado e validar no servidor antes de executar, quando o driver permitir.
- Explicar riscos de bloqueio, perda de dados ou incompatibilidade quando conhecidos.
- Alterações destrutivas exigem revisão de impacto e confirmação reforçada.

### 5. Consultas sem conhecimento de SQL

- Construtor visual de consultas: escolher tabela, colunas, filtros, ordenação e limite.
- Traduzir filtros para SQL parametrizado, evitando concatenar valores de entrada.
- Mostrar resultados em grade e permitir exportação com limites e feedback.
- Disponibilizar modelos prontos (buscar registros, contar, localizar nulos, duplicidades) adaptados ao driver.
- Manter editor SQL para quem preferir escrever comandos.

## Segurança e recuperação

- Separar autenticação do usuário do aplicativo das credenciais da conexão ao SGBD.
- Aplicar privilégios do próprio banco; o modo “somente leitura” deve ser reforçado também no servidor, não apenas na interface.
- Limitar resultados e tempo de execução; impedir comandos múltiplos ambíguos em ações visuais.
- Auditar ação, conexão, horário, resultado e objetos envolvidos sem guardar segredos.
- Antes de operações perigosas, informar se há suporte a transação/rollback. Não prometer desfazer quando o SGBD ou o DDL não permitir.
- Nunca criar ou exigir um banco interno exclusivo do DBM sem uma justificativa documentada. Avaliar primeiro persistência já disponível na plataforma Astral; manter apenas os metadados realmente necessários.

## Critérios de aceite de UX

- Um usuário iniciante consegue conectar, abrir uma tabela, filtrar dados e editar um registro sem escrever SQL.
- Uma pessoa consegue criar tabela e coluna pelo assistente visual, vendo uma prévia antes da execução.
- Erros explicam o problema em linguagem simples e preservam o que o usuário digitou.
- Nenhuma operação destrutiva é executada silenciosamente.
- A interface funciona com teclado e em viewport estreito.
- Os fluxos visuais usam os mesmos serviços e validações do console, sem rotas de segurança alternativas.
- Testes automatizados cobrem fluxos felizes, falhas de conexão, ausência de chave primária, validação e confirmação de operações destrutivas.

## Ordem de implementação sugerida

1. Conexão clara com solicitação/validação de credenciais.
2. Navegação Explorer + visualização paginada.
3. Edição de registros com identificação segura e confirmação.
4. Filtros visuais e construtor de consulta.
5. Assistentes para DDL.
6. Acessibilidade, responsividade, testes e textos de ajuda.

Cada entrega deve ser pequena, testável e compatível com os drivers suportados. Não declarar um fluxo concluído sem teste automatizado ou evidência manual registrada.
