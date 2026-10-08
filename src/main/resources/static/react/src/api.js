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
};

export default api;