import React, { useEffect, useState } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import api from '../api.js';

export default function StructureView({ conexaoId, schema, tabela, tipo = 'tabela', toast }) {
  const [est, setEst] = useState({ colunas: [], primarias: [], indices: [], restricoes: [] });
  const [ddl, setDdl] = useState('');
  const [ddlAberto, setDdlAberto] = useState(false);
  const [gerandoDdl, setGerandoDdl] = useState(false);

  const displaySchema = schema || 'public';
  const displayTabela = tabela || 'Tabela';

  useEffect(() => {
    if (!conexaoId || !tabela) {
      return;
    }
    api
      .estrutura(conexaoId, displaySchema, tabela)
      .then((res) => {
        if (res) {
          setEst({
            colunas: res.colunas || [],
            primarias: res.colunas?.filter((c) => c.is_primary_key).map((c) => c.name) || [],
            indices: res.indices || [],
            restricoes: res.restricoes || [],
          });
        }
      })
      .catch((e) => toast.current?.show({ severity: 'error', summary: 'Estrutura', detail: e.message, life: 6000 }));
  }, [conexaoId, displaySchema, tabela, toast]);

  const ehPk = (coluna) =>
    (est.primarias || []).includes(coluna) ||
    est.colunas.some((c) => (c.name === coluna || c.column_name === coluna) && c.is_primary_key);

  const verDdl = async () => {
    setGerandoDdl(true);
    try {
      const r = await api.ddl(conexaoId, displaySchema, tabela, tipo, tabela);
      setDdl(r.ddl || '');
      setDdlAberto(true);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'DDL', detail: e.message, life: 6000 });
    } finally {
      setGerandoDdl(false);
    }
  };

  return (
    <div className="estrutura">
      <div className="barra">
        <h3>
          <i className={`pi ${tipo === 'view' ? 'pi-eye' : 'pi-table'}`} /> {displaySchema}.<strong>{displayTabela}</strong>
        </h3>
        <Button
          label="Ver DDL"
          icon="pi pi-code"
          text
          loading={gerandoDdl}
          onClick={verDdl}
          tooltip="Gerar CREATE a partir do estado existente"
        />
      </div>

      <Dialog
        header={`DDL — ${displaySchema}.${displayTabela}`}
        visible={ddlAberto}
        style={{ width: '46rem' }}
        onHide={() => setDdlAberto(false)}
      >
        <pre className="sql-previa">{ddl}</pre>
        <div className="dialog-rodape">
          <div />
          <Button label="Fechar" text onClick={() => setDdlAberto(false)} />
        </div>
      </Dialog>

      <h4>Colunas ({est.colunas?.length || 0})</h4>
      <DataTable value={est.colunas} size="small" scrollable scrollHeight="20rem" stripedRows className="font-mono">
        <Column
          header="#"
          body={(_, opts) => opts.rowIndex + 1}
          style={{ width: '45px' }}
        />
        <Column
          field="name"
          header="Coluna"
          body={(r) => {
            const colName = r.name || r.column_name;
            const isPk = ehPk(colName);
            return (
              <span className="font-bold flex align-items-center gap-1">
                {isPk && <i className="pi pi-key text-yellow-400" title="Chave Primária" />}
                <span>{colName}</span>
              </span>
            );
          }}
        />
        <Column
          field="data_type"
          header="Tipo"
          body={(r) => <span className="text-cyan-300">{r.data_type || r.udt_name || 'varchar'}</span>}
        />
        <Column
          field="nullable"
          header="Nulo"
          body={(r) => {
            const isNull = r.nullable !== undefined ? r.nullable : r.is_nullable === 'YES';
            return isNull ? <Tag value="SIM" severity="warning" /> : <Tag value="NÃO" severity="success" />;
          }}
        />
        <Column
          field="default_value"
          header="Default"
          body={(r) => {
            const def = r.default_value || r.column_default;
            return def ? <code>{def}</code> : <span className="text-gray-500 italic">None</span>;
          }}
        />
      </DataTable>

      <h4>Restrições &amp; Constraints ({est.restricoes?.length || 0})</h4>
      <DataTable value={est.restricoes} size="small" emptyMessage="Nenhuma constraint encontrada." scrollable scrollHeight="12rem" stripedRows>
        <Column field="name" header="Nome da Constraint" />
        <Column field="constraint_type" header="Tipo" />
        <Column field="columns" header="Colunas" body={(r) => (r.columns || []).join(', ')} />
      </DataTable>

      <h4>Índices ({est.indices?.length || 0})</h4>
      <DataTable value={est.indices} size="small" emptyMessage="Nenhum índice encontrado." scrollable scrollHeight="12rem" stripedRows>
        <Column field="name" header="Nome do Índice" />
        <Column field="is_unique" header="Único" body={(r) => (r.is_unique ? <Tag value="UNIQUE" severity="info" /> : 'INDEX')} />
        <Column field="is_primary" header="Chave Primária" body={(r) => (r.is_primary ? <Tag value="PRIMARY KEY" severity="warning" /> : '')} />
      </DataTable>
    </div>
  );
}
