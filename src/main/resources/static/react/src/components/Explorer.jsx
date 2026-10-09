import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Tree } from 'primereact/tree';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { ProgressSpinner } from 'primereact/progressspinner';
import { ContextMenu } from 'primereact/contextmenu';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import api from '../api.js';

export default function Explorer({ conexaoId, esquemaInicial, onAbrirTabela, toast }) {
  const [schemas, setSchemas] = useState([]);
  const [schema, setSchema] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [selecionado, setSelecionado] = useState(null);

  const [menuNo, setMenuNo] = useState(null);
  const cm = useRef(null);
  const [ddl, setDdl] = useState('');
  const [ddlTitulo, setDdlTitulo] = useState('');
  const [ddlAberto, setDdlAberto] = useState(false);

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
    const grupos = [];
    const grupo = (chave, rotulo, filhos) => {
      if (filhos.length) {
        grupos.push({ key: chave, label: `${rotulo} (${filhos.length})`, icon: 'pi pi-folder', selectable: false, children: filhos });
      }
    };
    grupo('g:tabelas', 'Tabelas',
      catalogo.tabelas.filter(bate).map((t) => ({ key: `t:${schema}.${t}`, label: t, icon: 'pi pi-table', data: { tipo: 'tabela', schema, nome: t } })));
    grupo('g:views', 'Views',
      catalogo.views.filter(bate).map((v) => ({ key: `v:${schema}.${v}`, label: v, icon: 'pi pi-eye', data: { tipo: 'view', schema, nome: v } })));
    grupo('g:seq', 'Sequências',
      (catalogo.sequencias || []).filter(bate).map((s) => ({ key: `s:${schema}.${s}`, label: s, icon: 'pi pi-hashtag', data: { tipo: 'sequencia', schema, nome: s } })));
    grupo('g:func', 'Funções',
      (catalogo.funcoes || []).filter((f) => bate(f.nome)).map((f) => ({ key: `f:${schema}.${f.nome}`, label: `${f.nome} — ${f.tipo}`, icon: 'pi pi-code', data: { tipo: 'funcao', schema, nome: f.nome } })));
    grupo('g:trig', 'Triggers',
      (catalogo.triggers || []).filter((t) => bate(t.nome)).map((t) => ({ key: `r:${schema}.${t.tabela}.${t.nome}`, label: `${t.nome} (${t.tabela})`, icon: 'pi pi-bolt', data: { tipo: 'trigger', schema, nome: t.nome, tabela: t.tabela } })));
    grupo('g:tipos', 'Tipos',
      (catalogo.tipos || []).filter((t) => bate(t.nome)).map((t) => ({ key: `y:${schema}.${t.nome}`, label: `${t.nome} — ${t.tipo}`, icon: 'pi pi-box', data: { tipo: 'tipo', schema, nome: t.nome } })));
    grupo('g:ext', 'Extensões',
      (catalogo.extensoes || []).filter((e) => bate(e.nome)).map((e) => ({ key: `e:${e.nome}`, label: `${e.nome} ${e.versao}`, icon: 'pi pi-box', data: { tipo: 'extensao', schema, nome: e.nome } })));
    return grupos;
  }, [catalogo, filtro, schema]);

  const abrirDdl = async (d) => {
    try {
      const r = await api.ddl(conexaoId, d.schema, d.nome, d.tipo, d.tabela);
      setDdl(r.ddl);
      setDdlTitulo(`${d.schema}.${d.nome}`);
      setDdlAberto(true);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'DDL', detail: e.message, life: 6000 });
    }
  };

  const itensMenu = useMemo(() => {
    const d = menuNo?.data;
    if (!d?.nome) {
      return [];
    }
    const itens = [];
    if (d.tipo === 'tabela') {
      itens.push({ label: 'Abrir dados', icon: 'pi pi-table', command: () => onAbrirTabela(d.schema, d.nome, 'tabela', 0) });
      itens.push({ label: 'Ver estrutura', icon: 'pi pi-sitemap', command: () => onAbrirTabela(d.schema, d.nome, 'tabela', 1) });
    } else if (d.tipo === 'view') {
      itens.push({ label: 'Ver dados', icon: 'pi pi-table', command: () => onAbrirTabela(d.schema, d.nome, 'view', 0) });
      itens.push({ label: 'Ver estrutura', icon: 'pi pi-sitemap', command: () => onAbrirTabela(d.schema, d.nome, 'view', 1) });
    }
    if (d.tipo !== 'extensao' && d.tipo !== 'tipo') {
      itens.push({ label: 'Ver DDL', icon: 'pi pi-code', command: () => abrirDdl(d) });
    }
    itens.push({
      label: 'Copiar nome',
      icon: 'pi pi-copy',
      command: () => {
        navigator.clipboard?.writeText(d.nome);
        toast.current?.show({ severity: 'info', summary: 'Copiado', detail: d.nome, life: 1500 });
      },
    });
    return itens;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuNo]);

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
            const d = e.node?.data;
            if (d?.tipo === 'tabela' || d?.tipo === 'view') {
              onAbrirTabela(d.schema, d.nome, d.tipo, 0);
            }
          }}
          onContextMenu={(e) => {
            if (!e.node?.data?.nome) {
              return;
            }
            setMenuNo(e.node);
            cm.current.show(e.originalEvent);
          }}
        />
      </div>
      <div className="explorer-dica">
        <i className="pi pi-info-circle" /> Clique direito para ações
      </div>

      <ContextMenu ref={cm} model={itensMenu} />

      <Dialog header={`DDL — ${ddlTitulo}`} visible={ddlAberto} style={{ width: '46rem' }} onHide={() => setDdlAberto(false)}>
        <pre className="sql-previa">{ddl}</pre>
        <div className="dialog-rodape">
          <div />
          <Button label="Fechar" text onClick={() => setDdlAberto(false)} />
        </div>
      </Dialog>
    </div>
  );
}
