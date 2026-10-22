import axios from 'axios';

const baseURL = typeof window !== 'undefined' && window.location.pathname.startsWith('/dbm') ? '/dbm/api' : '/api';
const http = axios.create({ baseURL, timeout: 60000 });

// O backend responde sempre { success, data, erro }.
http.interceptors.response.use(
  (resp) => {
    const body = resp.data;
    if (body && typeof body === 'object' && 'success' in body) {
      if (!body.success) {
        const erro = body.erro || {};
        const e = new Error(erro.mensagem || 'Erro');
        e.codigo = erro.codigo;
        throw e;
      }
      return body.data;
    }
    return body;
  },
  (err) => {
    const erro = err.response?.data?.erro;
    if (erro) {
      const e = new Error(erro.mensagem || 'Erro');
      e.codigo = erro.codigo;
      return Promise.reject(e);
    }
    return Promise.reject(err);
  },
);

export const api = {
  conexoes: () => http.get('/conexoes'),
  criarConexao: (c) => http.post('/conexoes', c),
  atualizarConexao: (id, c) => http.put(`/conexoes/${id}`, c),
  removerConexao: (id) => http.delete(`/conexoes/${id}`),
  testarConexao: (id) => http.post(`/conexoes/${id}/testar`),
  conectar: (id) => http.post(`/conexoes/${id}/conectar`),
  desconectar: (id) => http.post(`/conexoes/${id}/desconectar`),
  drivers: () => http.get('/drivers'),
  grupos: () => http.get('/grupos'),
  schemas: (id) => http.get(`/conexoes/${id}/schemas`),
  catalogo: (id, schema) => http.get(`/conexoes/${id}/catalogo`, { params: { schema } }),
  estrutura: (id, schema, tabela) =>
    http.get(`/conexoes/${id}/estrutura`, { params: { schema, tabela } }),
  dados: (id, schema, tabela, pagina, tamanho, busca) =>
    http.get(`/conexoes/${id}/dados`, { params: { schema, tabela, pagina, tamanho, busca } }),
  salvarLinha: (id, schema, table, mode, keys, values) =>
    http.post(`/conexoes/${id}/dados/salvar`, { schema, table, mode, keys, values }),
  removerLinha: (id, schema, table, keys) =>
    http.post(`/conexoes/${id}/dados/remover`, { schema, table, keys }),
  executar: (id, sql, confirmar) =>
    http.post(`/conexoes/${id}/executar`, { sql, confirmar }),
  isql: (id, sql, explain_plan, manual_transaction) =>
    http.post(`/conexoes/${id}/isql`, { sql, explain_plan, manual_transaction }),
  commit: (id) => http.post(`/conexoes/${id}/commit`),
  rollback: (id) => http.post(`/conexoes/${id}/rollback`),

  // Bancos
  bancos: (id) => http.get(`/conexoes/${id}/bancos`),
  preverBanco: (id, b) => http.post(`/conexoes/${id}/bancos/sql`, b),
  criarBanco: (id, b) => http.post(`/conexoes/${id}/bancos`, b),
  droparBanco: (id, nome, confirmacao, forcar) =>
    http.delete(`/conexoes/${id}/bancos/${encodeURIComponent(nome)}`, { params: { confirmacao, forcar } }),

  // Schemas
  criarSchema: (id, nome, confirmar) => http.post(`/conexoes/${id}/schemas`, { nome, confirmar }),
  droparSchema: (id, nome, confirmacao, cascade) =>
    http.delete(`/conexoes/${id}/schemas/${encodeURIComponent(nome)}`, { params: { confirmacao, cascade } }),

  // DDL
  ddl: (id, schema, nome, tipo, tabela) =>
    http.get(`/conexoes/${id}/ddl`, { params: { schema, nome, tipo, tabela } }),

  // Recursos Avançados InterBase
  sweep: (id) => http.post(`/conexoes/${id}/sweep`),
  stats: (id) => http.get(`/conexoes/${id}/stats`),
  serverLog: (id) => http.get(`/conexoes/${id}/server-log`),
  extractFullDdl: (id) => http.get(`/conexoes/${id}/extract-ddl`),
  validate: (id) => http.post(`/conexoes/${id}/validate`),
  setGeneratorValue: (id, generator, value) =>
    http.post(`/conexoes/${id}/generator/set-value`, { generator, value }),
  dropTable: (id, schema, table) =>
    http.delete(`/conexoes/${id}/tabela/${encodeURIComponent(table)}`, { params: { schema } }),
};

export default api;
