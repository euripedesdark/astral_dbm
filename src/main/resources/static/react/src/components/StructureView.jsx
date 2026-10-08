import React, { useEffect, useState } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import api from '../api.js';

export default function StructureView({ conexaoId, schema, tabela, toast }) {
  const [est, setEst] = useState({ colunas: [], primarias: [], indices: [], estrangeiras: [] });

  useEffect(() => {
    if (!conexaoId || !schema || !tabela) {
      return;
    }
    api
      .estrutura(conexaoId, schema, tabela)
      .then(setEst)
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Estrutura', detail: e.message, life: 6000 }));
  }, [conexaoId, schema, tabela, toast]);

  const ehPk = (coluna) => est.primarias.includes(coluna);

  return (
    <div className="estrutura">
      <h3>
        <i className="pi pi-table" /> {schema}.<strong>{tabela}</strong>
      </h3>

      <h4>Colunas</h4>
      <DataTable value={est.colunas} size="small" scrollable scrollHeight="20rem">
        <Column
          field="column_name"
          header="Coluna"
          body={(r) => (
            <span>
              {ehPk(r.column_name) && <i className="pi pi-key" style={{ color: 'var(--yellow-400)' }} />} {r.column_name}
            </span>
          )}
        />
        <Column field="data_type" header="Tipo" />
        <Column field="character_maximum_length" header="Tam." />
        <Column
          field="is_nullable"
          header="Nulo"
          body={(r) => (r.is_nullable === 'YES' ? <Tag value="SIM" severity="warning" /> : <Tag value="não" />)}
        />
        <Column field="column_default" header="Default" body={(r) => <code>{r.column_default}</code>} />
      </DataTable>

      <h4>Chaves estrangeiras</h4>
      <DataTable value={est.estrangeiras} size="small" emptyMessage="Nenhuma" scrollable scrollHeight="12rem">
        <Column field="constraint_name" header="Restrição" />
        <Column field="column_name" header="Coluna" />
        <Column field="ref_tabela" header="Referência" body={(r) => `${r.ref_schema}.${r.ref_tabela}.${r.ref_coluna}`} />
      </DataTable>

      <h4>Índices</h4>
      <DataTable value={est.indices} size="small" emptyMessage="Nenhum" scrollable scrollHeight="12rem">
        <Column field="indexname" header="Índice" />
        <Column field="indexdef" header="Definição" body={(r) => <code className="quebra">{r.indexdef}</code>} />
      </DataTable>
    </div>
  );
}