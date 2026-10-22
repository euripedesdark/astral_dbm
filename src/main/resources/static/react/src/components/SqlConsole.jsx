import React, { useRef, useState } from 'react';
import { Button } from 'primereact/button';
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
  const [resultadoAba, setResultadoAba] = useState('Results');
  const [historico, setHistorico] = useState([]);
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
      setHistorico(h => [{ sql: sqlRef.current, quando: new Date().toLocaleTimeString(), sucesso: true }, ...h].slice(0, 25));
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
    <div className="sql-console desktop-sql">
      <div className="sql-editor-toolbar">
        <Button icon="pi pi-play" label="Run SQL (F9)" className="run-sql" disabled={executando} onClick={() => rodar(false)} />
        <Button icon="pi pi-align-left" label="Format" outlined onClick={() => setSql(v => v.replace(/\\s+(FROM|WHERE|GROUP BY|ORDER BY|JOIN|LEFT JOIN|LIMIT)\\b/gi, '\\n$1'))} />
        <Button icon="pi pi-eraser" label="Clear" text onClick={() => { setSql(''); setSaida(null); }} />
        {somenteLeitura && <span className="aviso-ro">Read only</span>}
      </div>
      {executando && <ProgressBar mode="indeterminate" style={{ height: '3px' }} />}
      <div className="sql-editor-region">
        <div className="sql-editor-lines" aria-hidden="true">{sql.split('\\n').map((_, i) => <div key={i}>{i + 1}</div>)}</div>
        <textarea spellCheck={false} aria-label="SQL editor" value={sql} onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if (e.key === 'F9' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); rodar(false); } }}
          className="editor-sql" placeholder="Write SQL here..." />
      </div>
      <div className="sql-results-tabs" role="tablist">
        {['Results','Explain Plan','Script Output','Query History'].map(t =>
          <button role="tab" aria-selected={resultadoAba === t} className={resultadoAba === t ? 'active' : ''} key={t} onClick={() => setResultadoAba(t)}>{t}{t === 'Query History' ? ` (${historico.length})` : ''}</button>)}
      </div>
      <div className="saida">
        {resultadoAba === 'Results' && <>
          {duracao !== null && <div className="duracao">Execution time: {duracao} ms</div>}
          {!resultados.length && <div className="vazio-aba">No results to display. Run a SELECT query.</div>}
          {resultados.map((b, i) => <Resultado key={i} bloco={b} indice={i} />)}
        </>}
        {resultadoAba === 'Query History' && historico.map((h,i) => <button className="history-entry" key={i} onClick={() => { setSql(h.sql); setResultadoAba('Results'); }}>{h.quando} — {h.sql.slice(0,110)}</button>)}
        {resultadoAba === 'Explain Plan' && <div className="vazio-aba">The backend does not expose an execution-plan API in this SQL console yet.</div>}
        {resultadoAba === 'Script Output' && <div className="vazio-aba">Execute a query to view results in the Results tab.</div>}
      </div>
      <ConfirmDialog />
    </div>
  );
}
