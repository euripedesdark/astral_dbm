import React, { useState, useRef, useEffect } from 'react';
import { Button } from 'primereact/button';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { TabView, TabPanel } from 'primereact/tabview';
import { ProgressBar } from 'primereact/progressbar';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Dropdown } from 'primereact/dropdown';
import api from '../api.js';

function formatCell(val) {
  if (val === null || val === undefined || val === 'NULL') {
    return <span className="ib-null-badge">&lt;NULL&gt;</span>;
  }
  if (typeof val === 'boolean') {
    return (
      <span className={`ib-bool-badge ${val ? 'ib-bool-true' : 'ib-bool-false'}`}>
        {val ? 'TRUE' : 'FALSE'}
      </span>
    );
  }
  if (typeof val === 'number') {
    return <span className="ib-numeric-cell font-mono">{val.toLocaleString('pt-BR')}</span>;
  }
  if (typeof val === 'object') {
    return <span className="ib-json-cell font-mono">{JSON.stringify(val)}</span>;
  }
  return <span>{String(val)}</span>;
}

export default function IsqlEditor({
  activeDatabase,
  initialQuery = 'SELECT now() AS data_hora, version() AS versao;',
  onConnect,
  onQueryDone,
  toast,
}) {
  const [sql, setSql] = useState(initialQuery);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState(null);
  const [activeBottomTab, setActiveBottomTab] = useState(0);

  // Transaction state
  const [manualTx, setManualTx] = useState(false);
  const [inTx, setInTx] = useState(false);
  const [explainPlan, setExplainPlan] = useState(false);

  // History & Snippets State
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([
    'SELECT now() AS data_hora, version() AS versao;',
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';",
  ]);

  // Export Modal State
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');

  // Import Assistant Modal
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importTargetTable, setImportTargetTable] = useState('');
  const [importFile, setImportFile] = useState('');

  const editorRef = useRef(null);

  const lineCount = useMemo(() => {
    return Math.max(1, (sql.match(/\n/g) || []).length + 1);
  }, [sql]);

  const lineNumbers = useMemo(() => {
    return Array.from({ length: lineCount }, (_, i) => i + 1);
  }, [lineCount]);

  const executeQuery = async () => {
    if (!activeDatabase) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Sem Conexão',
        detail: 'Conecte-se a uma base antes de executar instruções SQL.',
        life: 3000,
      });
      return;
    }

    const trimmed = sql.trim();
    if (!trimmed) return;

    setExecuting(true);
    const start = performance.now();

    try {
      const res = await api.isql(activeDatabase.id, trimmed, explainPlan, manualTx);
      const elapsed = Math.round(performance.now() - start);

      setResult({
        ...res,
        executionTimeMs: elapsed,
      });

      if (!history.includes(trimmed)) {
        setHistory((prev) => [trimmed, ...prev.slice(0, 20)]);
      }

      if (manualTx) {
        setInTx(true);
      }

      if (res.columns && res.columns.length > 0) {
        setActiveBottomTab(0);
      } else if (res.plan) {
        setActiveBottomTab(1);
      } else {
        setActiveBottomTab(2);
      }

      if (onQueryDone) {
        onQueryDone(elapsed, res.total_rows || res.rows?.length || 0);
      }
    } catch (e) {
      setResult({
        columns: [],
        rows: [],
        message: `ERRO SQL: ${e.message}`,
        executionTimeMs: Math.round(performance.now() - start),
      });
      setActiveBottomTab(2);
      toast.current?.show({
        severity: 'error',
        summary: 'Erro de Execução SQL',
        detail: e.message,
        life: 6000,
      });
    } finally {
      setExecuting(false);
    }
  };

  const handleCommit = async () => {
    if (!activeDatabase) return;
    try {
      await api.commit(activeDatabase.id);
      setInTx(false);
      toast.current?.show({ severity: 'success', summary: 'COMMIT', detail: 'Transação confirmada no motor.', life: 2000 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro COMMIT', detail: e.message, life: 5000 });
    }
  };

  const handleRollback = async () => {
    if (!activeDatabase) return;
    try {
      await api.rollback(activeDatabase.id);
      setInTx(false);
      toast.current?.show({ severity: 'warn', summary: 'ROLLBACK', detail: 'Transação desfeita.', life: 2000 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro ROLLBACK', detail: e.message, life: 5000 });
    }
  };

  const handleExportData = () => {
    if (!result?.rows || result.rows.length === 0) {
      toast.current?.show({ severity: 'warn', summary: 'Export', detail: 'Sem dados para exportar.', life: 2500 });
      return;
    }

    let content = '';
    const ext = exportFormat;

    if (exportFormat === 'csv') {
      content += (result.columns || []).map((c) => `"${c}"`).join(',') + '\n';
      result.rows.forEach((r) => {
        content += r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n';
      });
    } else if (exportFormat === 'json') {
      const records = result.rows.map((r) => {
        const item = {};
        result.columns.forEach((c, idx) => {
          item[c] = r[idx];
        });
        return item;
      });
      content = JSON.stringify(records, null, 2);
    } else if (exportFormat === 'sql') {
      const tbl = 'resultado_export';
      result.rows.forEach((r) => {
        const vals = r.map((v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)).join(', ');
        content += `INSERT INTO ${tbl} (${(result.columns || []).join(', ')}) VALUES (${vals});\n`;
      });
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `query_result_${Date.now()}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
    setExportModalOpen(false);
    toast.current?.show({ severity: 'success', summary: 'Export Concluído', detail: `Arquivo .${ext} baixado.`, life: 3000 });
  };

  // Convert row values for PrimeReact DataTable — PRESERVE RAW VALUES!
  const gridData = (result?.rows || []).map((row, rowIdx) => {
    const obj = { __rowNum: rowIdx + 1 };
    (result?.columns || []).forEach((col, colIdx) => {
      const val = Array.isArray(row) ? row[colIdx] : (row && row[col] !== undefined ? row[col] : row?.[colIdx]);
      obj[col] = val === undefined ? null : val;
    });
    return obj;
  });

  return (
    <div className="ib-isql-container">
      {/* 1. ISQL Ribbon / Toolbar */}
      <div className="ib-sql-toolbar flex align-items-center justify-content-between">
        <div className="flex align-items-center gap-1">
          <Button
            icon="pi pi-play"
            label="Execute (F9)"
            className="p-button-success p-button-sm font-bold"
            onClick={executeQuery}
            loading={executing}
            tooltip="Executar instrução SQL completa (F9 / Ctrl+Enter)"
            tooltipOptions={{ position: 'bottom' }}
          />
          <Button
            icon="pi pi-compass"
            label="Explain Plan"
            className={`p-button-sm ${explainPlan ? 'p-button-info' : 'p-button-secondary p-button-outlined'}`}
            onClick={() => {
              setExplainPlan((prev) => !prev);
              toast.current?.show({ severity: 'info', summary: 'Plano', detail: !explainPlan ? 'Explain Plan ATIVADO.' : 'Explain Plan desativado.', life: 1500 });
            }}
            tooltip="Gerar plano de execução do otimizador"
            tooltipOptions={{ position: 'bottom' }}
          />
          <Button
            icon="pi pi-trash"
            className="p-button-secondary p-button-outlined p-button-sm"
            onClick={() => setSql('')}
            tooltip="Limpar editor de comandos"
            tooltipOptions={{ position: 'bottom' }}
          />

          <div className="border-left-1 border-secondary mx-2" style={{ height: '24px' }} />

          {/* Transaction Controls */}
          <Button
            icon="pi pi-sync"
            label={manualTx ? 'Manual TX: ON' : 'Auto-Commit'}
            className={`p-button-sm ${manualTx ? 'p-button-warning' : 'p-button-secondary p-button-outlined'}`}
            onClick={() => {
              setManualTx((prev) => !prev);
              toast.current?.show({
                severity: 'info',
                summary: 'Controle Transacional',
                detail: !manualTx ? 'Transação manual explícita (SET TRANSACTION) ativa.' : 'Auto-Commit ativo.',
                life: 2500,
              });
            }}
            tooltip="Alternar entre modo Auto-Commit e Transação Explícita (InterBase SET TRANSACTION)"
            tooltipOptions={{ position: 'bottom' }}
          />

          {manualTx && (
            <>
              <Button
                icon="pi pi-check"
                label="Commit"
                className="p-button-success p-button-sm"
                disabled={!inTx}
                onClick={handleCommit}
                tooltip="Confirmar transação ativa (COMMIT)"
                tooltipOptions={{ position: 'bottom' }}
              />
              <Button
                icon="pi pi-times"
                label="Rollback"
                className="p-button-danger p-button-sm"
                disabled={!inTx}
                onClick={handleRollback}
                tooltip="Desfazer transação ativa (ROLLBACK)"
                tooltipOptions={{ position: 'bottom' }}
              />
            </>
          )}

          <div className="border-left-1 border-secondary mx-2" style={{ height: '24px' }} />

          {/* Data Export / Import Buttons */}
          <Button
            icon="pi pi-download"
            label="Export Data"
            className="p-button-secondary p-button-outlined p-button-sm"
            onClick={() => setExportModalOpen(true)}
            disabled={!result?.rows || result.rows.length === 0}
            tooltip="Exportar grade de resultados para CSV, JSON ou SQL INSERT"
            tooltipOptions={{ position: 'bottom' }}
          />
          <Button
            icon="pi pi-upload"
            label="Import Assistant"
            className="p-button-secondary p-button-outlined p-button-sm"
            onClick={() => setImportModalOpen(true)}
            tooltip="Assistente de importação de dados externos"
            tooltipOptions={{ position: 'bottom' }}
          />

          <Button
            icon="pi pi-history"
            className="p-button-secondary p-button-outlined p-button-sm ml-2"
            onClick={() => setHistoryOpen(true)}
            tooltip="Histórico recente de instruções executadas"
            tooltipOptions={{ position: 'bottom' }}
          />
        </div>

        <div className="text-xs font-mono text-muted mr-2 flex align-items-center gap-3">
          {inTx && <span className="text-yellow-400 font-bold">● Transação Aberta</span>}
          {result?.executionTimeMs !== undefined && (
            <span>Tempo: {result.executionTimeMs} ms</span>
          )}
          {result?.total_rows !== undefined && (
            <span>Linhas: {result.total_rows}</span>
          )}
        </div>
      </div>

      {/* 2. SQL Code Editor Canvas */}
      <div className="ib-query-input-pane astral-query-canvas">
        <div className="astral-line-numbers" aria-hidden="true">
          {lineNumbers.map((num) => (
            <div key={num}>{num}</div>
          ))}
        </div>
        <textarea
          ref={editorRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              executeQuery();
            } else if (e.key === 'F9') {
              e.preventDefault();
              executeQuery();
            }
          }}
          className="ib-code-editor w-full font-mono text-sm"
          placeholder="Digite instruções SQL compatíveis com InterBase ou PostgreSQL (ex: SELECT * FROM tabela;)..."
          spellCheck={false}
        />
      </div>

      {executing && <ProgressBar mode="indeterminate" style={{ height: '3px' }} />}

      {/* 3. Results Tabbed Panel */}
      <div className="ib-results-pane">
        <TabView activeIndex={activeBottomTab} onTabChange={(e) => setActiveBottomTab(e.index)}>
          {/* Tab 1: Results Grid */}
          <TabPanel header={`Results (${gridData.length})`} leftIcon="pi pi-table">
            {gridData.length > 0 ? (
              <DataTable
                value={gridData}
                size="small"
                scrollable
                scrollHeight="220px"
                className="ib-data-table font-mono"
                stripedRows
              >
                <Column field="__rowNum" header="#" style={{ width: '50px', color: '#888', textAlign: 'center' }} />
                {(result?.columns || []).map((col) => (
                  <Column
                    key={col}
                    field={col}
                    header={col}
                    sortable
                    body={(r) => formatCell(r[col])}
                  />
                ))}
              </DataTable>
            ) : (
              <div className="ib-empty-results">
                <i className="pi pi-info-circle text-muted mr-2" />
                {result?.message || 'Nenhum resultado para exibir. Execute um comando SELECT.'}
              </div>
            )}
          </TabPanel>

          {/* Tab 2: Explain Plan */}
          <TabPanel header="Explain Plan" leftIcon="pi pi-compass">
            {result?.plan ? (
              <pre className="ib-plan-output font-mono">{result.plan}</pre>
            ) : (
              <div className="ib-empty-results">
                Clique no botão <strong>Explain Plan</strong> para visualizar o plano de execução do otimizador.
              </div>
            )}
          </TabPanel>

          {/* Tab 3: Script Output */}
          <TabPanel header="Script Output" leftIcon="pi pi-file">
            <div className="ib-script-output font-mono">
              <pre>{result?.message || 'Pronto para executar instruções.'}</pre>
            </div>
          </TabPanel>
        </TabView>
      </div>

      {/* Export Assistant Modal */}
      <Dialog
        header="Export Query Result"
        visible={exportModalOpen}
        style={{ width: '400px' }}
        onHide={() => setExportModalOpen(false)}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" text onClick={() => setExportModalOpen(false)} />
            <Button label="Exportar" icon="pi pi-download" onClick={handleExportData} />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div>
            <label className="text-xs font-bold block mb-1">Formato do Arquivo:</label>
            <Dropdown
              value={exportFormat}
              options={[
                { label: 'CSV (Valores Separados por Vírgula)', value: 'csv' },
                { label: 'JSON (Array de Objetos)', value: 'json' },
                { label: 'SQL (Comandos INSERT)', value: 'sql' },
              ]}
              onChange={(e) => setExportFormat(e.value)}
              className="w-full"
            />
          </div>
          <div className="text-xs text-muted">
            Total de registros a exportar: <strong>{result?.rows?.length || 0}</strong>
          </div>
        </div>
      </Dialog>

      {/* Import Assistant Modal */}
      <Dialog
        header={<span><i className="pi pi-upload text-green-400 mr-2" />Import Data Assistant</span>}
        visible={importModalOpen}
        style={{ width: '500px' }}
        onHide={() => setImportModalOpen(false)}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Fechar" text onClick={() => setImportModalOpen(false)} />
            <Button
              label="Executar Import"
              icon="pi pi-check"
              className="p-button-success"
              onClick={() => {
                toast.current?.show({
                  severity: 'info',
                  summary: 'Import Assistant',
                  detail: `Lendo ${importFile} para a tabela "${importTargetTable}"...`,
                  life: 4000,
                });
                setImportModalOpen(false);
              }}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div>
            <label className="text-xs font-bold block mb-1">Target Table (Tabela Destino):</label>
            <InputText
              value={importTargetTable}
              onChange={(e) => setImportTargetTable(e.target.value)}
              placeholder="ex: bc_core_usuario"
              className="w-full font-mono p-inputtext-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold block mb-1">Arquivo Fonte (CSV / JSON / SQL):</label>
            <InputText
              value={importFile}
              onChange={(e) => setImportFile(e.target.value)}
              placeholder="/caminho/para/dados.csv"
              className="w-full font-mono p-inputtext-sm"
            />
          </div>
        </div>
      </Dialog>

      {/* History Dialog */}
      <Dialog
        header="Query History"
        visible={historyOpen}
        style={{ width: '600px' }}
        onHide={() => setHistoryOpen(false)}
        footer={<Button label="Fechar" text onClick={() => setHistoryOpen(false)} />}
      >
        <div className="flex flex-column gap-2 max-h-20rem overflow-y-auto pt-2">
          {history.map((h, i) => (
            <div
              key={i}
              className="p-2 border-round surface-ground cursor-pointer hover:surface-hover font-mono text-xs flex justify-content-between align-items-center"
              onClick={() => {
                setSql(h);
                setHistoryOpen(false);
              }}
            >
              <span className="text-overflow-ellipsis white-space-nowrap overflow-hidden mr-2">{h}</span>
              <Button icon="pi pi-arrow-up-left" text size="small" />
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
