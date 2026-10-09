import axios from 'axios';

const http = axios.create({ baseURL: '/api', timeout: 60000 });

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
  drivers: () => http.get('/drivers'),
  grupos: () => http.get('/grupos'),
  schemas: (id) => http.get(`/conexoes/${id}/schemas`),
  catalogo: (id, schema) => http.get(`/conexoes/${id}/catalogo`, { params: { schema } }),
  estrutura: (id, schema, tabela) =>
    http.get(`/conexoes/${id}/estrutura`, { params: { schema, tabela } }),
  dados: (id, schema, tabela, pagina, tamanho, busca) =>
    http.get(`/conexoes/${id}/dados`, { params: { schema, tabela, pagina, tamanho, busca } }),
  executar: (id, sql, confirmar) =>
    http.post(`/conexoes/${id}/executar`, { sql, confirmar }),

  // Bancos (menu "Bancos", §4)
  bancos: (id) => http.get(`/conexoes/${id}/bancos`),
  preverBanco: (id, b) => http.post(`/conexoes/${id}/bancos/sql`, b),
  criarBanco: (id, b) => http.post(`/conexoes/${id}/bancos`, b),
  droparBanco: (id, nome, confirmacao, forcar) =>
    http.delete(`/conexoes/${id}/bancos/${encodeURIComponent(nome)}`, { params: { confirmacao, forcar } }),

  // Schemas (menu "Schemas", §4)
  criarSchema: (id, nome, confirmar) => http.post(`/conexoes/${id}/schemas`, { nome, confirmar }),
  droparSchema: (id, nome, confirmacao, cascade) =>
    http.delete(`/conexoes/${id}/schemas/${encodeURIComponent(nome)}`, { params: { confirmacao, cascade } }),

  // DDL de objeto (menu "Objetos", §9/§10.3)
  ddl: (id, schema, nome, tipo, tabela) =>
    http.get(`/conexoes/${id}/ddl`, { params: { schema, nome, tipo, tabela } }),
};

export default api;