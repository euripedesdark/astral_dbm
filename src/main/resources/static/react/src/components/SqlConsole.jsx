import React, { useRef, useState } from 'react';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Message } from 'primereact/message';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { ProgressBar } from 'primereact/progressbar';
import api from '../api.js';

function formatarCelula(v) {
  if (v === null || v === undefined) {
    return <span className="nulo">NULL</span>;
  }
  if (typeof v === 'object') {
    return <code>{JSON.stringify(v)}</code>;
  }
  return String(v);
}

function Resultado({ bloco, indice }) {
  if (!bloco) {
    return null;
  }
  if (bloco.tipo === 'consulta') {
    return (
      <div className="resultado">
        <div className="resultado-titulo">
          Resultado {indice + 1} — {bloco.total} linha(s)
        </div>
        <DataTable value={bloco.linhas.map((l) => Object.fromEntries(bloco.colunas.map((c, i) => [c, l[i]])))}
          size="small" scrollable scrollHeight="16rem">
          {bloco.colunas.map((c) => (
            <Column key={c} field={c} header={c} body={(r) => formatarCelula(r[c])} />
          ))}
        </DataTable>
      </div>
    );
  }
  return (
    <Message
      severity="success"
      text={`Comando ${bloco.comando} — ${bloco.linhasAfetadas} linha(s) afetada(s).`}
      className="w-full"
    />
  );
}

export default function SqlConsole({ conexaoId, toast, somenteLeitura }) {
  const [sql, setSql] = useState('select now();');
  const [saida, setSaida] = useState(null);
  const [executando, setExecutando] = useState(false);
  const [duracao, setDuracao] = useState(null);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const rodar = async (confirmar) => {
    if (!conexaoId) {
      toast.current?.show({ severity: 'warn', summary: 'Sem conexão', detail: 'Conecte-se primeiro.', life: 4000 });
      return;
    }
    setExecutando(true);
    const inicio = performance.now();
    try {
      const r = await api.executar(conexaoId, sqlRef.current, confirmar);
      setSaida(r);
      setDuracao(Math.round(performance.now() - inicio));
    } catch (e) {
      if (e.codigo === 'CONFIRMACAO_NECESSARIA') {
        confirmDialog({
          header: 'Confirmar escrita',
          message: e.message,
          icon: 'pi pi-exclamation-triangle',
          acceptLabel: 'Executar',
          rejectLabel: 'Cancelar',
          accept: () => rodar(true),
        });
      } else {
        setSaida(null);
        toast.current?.show({ severity: 'error', summary: 'Erro SQL', detail: e.message, life: 8000 });
      }
    } finally {
      setExecutando(false);
    }
  };

  const resultados = saida?.resultados?.length ? saida.resultados : saida ? [saida.resultado] : [];

  return (
    <div className="sql-console">
      <div className="barra">
        <span className="alvo">
          <i className="pi pi-terminal" /> Console SQL
          {somenteLeitura && <span className="aviso-ro">somente leitura</span>}
        </span>
        <Button icon="pi pi-play" label="Executar (Ctrl+Enter)" onClick={() => rodar(false)} disabled={executando} />
        <Button icon="pi pi-eraser" text label="Limpar" onClick={() => { setSql(''); setSaida(null); }} />
      </div>

      {executando && <ProgressBar mode="indeterminate" style={{ height: '3px' }} />}

      <InputTextarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            rodar(false);
          }
        }}
        rows={8}
        autoResize
        className="editor-sql"
        placeholder="Escreva o SQL. Use ; para separar instruções."
      />

      <div className="saida">
        {duracao !== null && <div className="duracao">{duracao} ms</div>}
        {resultados.map((b, i) => (
          <Resultado key={i} bloco={b} indice={i} />
        ))}
      </div>

      <ConfirmDialog />
    </div>
  );
}