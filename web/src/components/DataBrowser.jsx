import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { ProgressBar } from 'primereact/progressbar';
import api from '../api.js';

function formatar(v) {
  if (v === null || v === undefined || v === 'NULL') {
    return <span className="ib-null-badge">&lt;NULL&gt;</span>;
  }
  if (typeof v === 'boolean') {
    return (
      <span className={`ib-bool-badge ${v ? 'ib-bool-true' : 'ib-bool-false'}`}>
        {v ? 'TRUE' : 'FALSE'}
      </span>
    );
  }
  if (typeof v === 'number') {
    return <span className="ib-numeric-cell font-mono">{v.toLocaleString('pt-BR')}</span>;
  }
  if (typeof v === 'object') {
    return <code className="ib-json-cell">{JSON.stringify(v)}</code>;
  }
  return String(v);
}

export default function DataBrowser({ conexaoId, schema, tabela, toast }) {
  const [dados, setDados] = useState({ linhas: [], total: 0, columns: [] });
  const [pagina, setPagina] = useState(0);
  const [tamanho, setTamanho] = useState(50);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [carregando, setCarregando] = useState(false);

  const displaySchema = schema || 'public';
  const displayTabela = tabela || 'Tabela';

  useEffect(() => {
    setPagina(0);
    setBusca('');
    setBuscaAplicada('');
  }, [conexaoId, schema, tabela]);

  useEffect(() => {
    if (!conexaoId || !tabela) {
      return;
    }
    setCarregando(true);
    api
      .dados(conexaoId, displaySchema, tabela, pagina + 1, tamanho, buscaAplicada)
      .then((res) => {
        if (res && res.rows && res.columns) {
          const rows = res.rows.map((r, i) => {
            const obj = { __rowNum: pagina * tamanho + i + 1 };
            res.columns.forEach((col, idx) => {
              obj[col] = Array.isArray(r) ? r[idx] : r?.[col];
            });
            return obj;
          });
          setDados({ linhas: rows, total: res.total_rows || rows.length, columns: res.columns });
        } else if (res && res.linhas) {
          setDados(res);
        } else {
          setDados({ linhas: [], total: 0, columns: [] });
        }
      })
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Dados', detail: e.message, life: 6000 }))
      .finally(() => setCarregando(false));
  }, [conexaoId, displaySchema, tabela, pagina, tamanho, buscaAplicada, toast]);

  const colunas = useMemo(() => {
    if (dados.columns?.length) {
      return dados.columns;
    }
    if (dados.linhas?.length) {
      return Object.keys(dados.linhas[0]).filter((k) => k !== '__rowNum');
    }
    return [];
  }, [dados]);

  return (
    <div className="data-browser">
      <div className="barra">
        <span className="alvo">
          <i className="pi pi-table" /> {displaySchema}.<strong>{displayTabela}</strong>
        </span>
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={busca}
            placeholder="Buscar..."
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setBuscaAplicada(busca)}
          />
        </span>
        <Button icon="pi pi-search" label="Buscar" onClick={() => setBuscaAplicada(busca)} />
        <Button icon="pi pi-refresh" text onClick={() => setBuscaAplicada(busca)} />
      </div>

      {carregando && <ProgressBar mode="indeterminate" style={{ height: '3px' }} />}

      <DataTable
        value={dados.linhas}
        scrollable
        scrollHeight="flex"
        size="small"
        lazy
        paginator
        rows={tamanho}
        totalRecords={dados.total}
        first={pagina * tamanho}
        onPage={(e) => {
          setPagina(e.page);
          setTamanho(e.rows);
        }}
        emptyMessage="Sem linhas."
        stripedRows
        className="font-mono"
      >
        <Column
          header="#"
          body={(r) => r.__rowNum}
          style={{ width: '4rem', textAlign: 'center' }}
          frozen
        />
        {colunas.map((c) => (
          <Column key={c} field={c} header={c} body={(r) => formatar(r[c])} sortable />
        ))}
      </DataTable>

      <div className="rodape">{dados.total} linha(s) encontrada(s)</div>
    </div>
  );
}
