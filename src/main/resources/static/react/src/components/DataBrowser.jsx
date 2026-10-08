import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { ProgressBar } from 'primereact/progressbar';
import api from '../api.js';

function formatar(v) {
  if (v === null || v === undefined) {
    return <span className="nulo">NULL</span>;
  }
  if (typeof v === 'object') {
    return <code>{JSON.stringify(v)}</code>;
  }
  return String(v);
}

export default function DataBrowser({ conexaoId, schema, tabela, toast }) {
  const [dados, setDados] = useState({ linhas: [], total: 0 });
  const [pagina, setPagina] = useState(0);
  const [tamanho, setTamanho] = useState(100);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    setPagina(0);
    setBusca('');
    setBuscaAplicada('');
  }, [conexaoId, schema, tabela]);

  useEffect(() => {
    if (!conexaoId || !schema || !tabela) {
      return;
    }
    setCarregando(true);
    api
      .dados(conexaoId, schema, tabela, pagina, tamanho, buscaAplicada)
      .then(setDados)
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Dados', detail: e.message, life: 6000 }))
      .finally(() => setCarregando(false));
  }, [conexaoId, schema, tabela, pagina, tamanho, buscaAplicada, toast]);

  const colunas = useMemo(() => {
    if (dados.linhas?.length) {
      return Object.keys(dados.linhas[0]);
    }
    return [];
  }, [dados]);

  return (
    <div className="data-browser">
      <div className="barra">
        <span className="alvo">
          <i className="pi pi-table" /> {schema}.<strong>{tabela}</strong>
        </span>
        <span className="p-input-icon-left">
          <i className="pi pi-search" />
          <InputText
            value={busca}
            placeholder="Buscar (ILIKE em colunas de texto)"
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
      >
        <Column
          header="#"
          body={(_, opts) => pagina * tamanho + opts.rowIndex + 1}
          style={{ width: '4rem' }}
          frozen
        />
        {colunas.map((c) => (
          <Column key={c} field={c} header={c} body={(r) => formatar(r[c])} />
        ))}
      </DataTable>

      <div className="rodape">{dados.total} linha(s)</div>
    </div>
  );
}