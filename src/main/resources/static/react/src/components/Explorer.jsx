import React, { useEffect, useMemo, useState } from 'react';
import { Tree } from 'primereact/tree';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { ProgressSpinner } from 'primereact/progressspinner';
import api from '../api.js';

export default function Explorer({ conexaoId, esquemaInicial, onAbrirTabela, toast }) {
  const [schemas, setSchemas] = useState([]);
  const [schema, setSchema] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [selecionado, setSelecionado] = useState(null);

  useEffect(() => {
    if (!conexaoId) {
      setSchemas([]);
      setCatalogo(null);
      return;
    }
    setCarregando(true);
    api
      .schemas(conexaoId)
      .then((s) => {
        setSchemas(s);
        setSchema((atual) => atual || esquemaInicial || s[0] || null);
      })
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Explorer', detail: e.message, life: 6000 }))
      .finally(() => setCarregando(false));
  }, [conexaoId, esquemaInicial, toast]);

  useEffect(() => {
    if (!conexaoId || !schema) {
      return;
    }
    setCarregando(true);
    api
      .catalogo(conexaoId, schema)
      .then(setCatalogo)
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Catálogo', detail: e.message, life: 6000 }))
      .finally(() => setCarregando(false));
  }, [conexaoId, schema, toast]);

  const arvore = useMemo(() => {
    if (!catalogo) {
      return [];
    }
    const bate = (n) => !filtro || n.toLowerCase().includes(filtro.toLowerCase());
    const tabelas = catalogo.tabelas.filter(bate).map((t) => ({
      key: `t:${schema}.${t}`,
      label: t,
      icon: 'pi pi-table',
      data: { tipo: 'tabela', schema, nome: t },
    }));
    const views = catalogo.views.filter(bate).map((v) => ({
      key: `v:${schema}.${v}`,
      label: v,
      icon: 'pi pi-eye',
      data: { tipo: 'view', schema, nome: v },
    }));
    const nos = [];
    if (tabelas.length) {
      nos.push({ key: 'g:tabelas', label: `Tabelas (${tabelas.length})`, icon: 'pi pi-folder', children: tabelas });
    }
    if (views.length) {
      nos.push({ key: 'g:views', label: `Views (${views.length})`, icon: 'pi pi-folder', children: views });
    }
    return nos;
  }, [catalogo, filtro, schema]);

  if (!conexaoId) {
    return <div className="explorer-vazio">Selecione uma conexão para navegar.</div>;
  }

  return (
    <div className="explorer">
      <div className="painel-titulo">
        <span>Explorer</span>
        {carregando && <ProgressSpinner style={{ width: 18, height: 18 }} strokeWidth={6} />}
      </div>
      <div className="explorer-filtros">
        <Dropdown
          value={schema}
          options={schemas.map((s) => ({ label: s, value: s }))}
          onChange={(e) => setSchema(e.value)}
          placeholder="schema"
          className="w-full"
        />
        <span className="p-input-icon-left w-full">
          <i className="pi pi-search" />
          <InputText value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar objetos" className="w-full" />
        </span>
      </div>
      <div className="explorer-arvore">
        <Tree
          value={arvore}
          selectionMode="single"
          selectionKeys={selecionado}
          onSelectionChange={(e) => setSelecionado(e.value)}
          onNodeSelect={(e) => {
            if (e.node.data?.tipo) {
              onAbrirTabela(e.node.data.schema, e.node.data.nome, e.node.data.tipo);
            }
          }}
        />
      </div>
    </div>
  );
}