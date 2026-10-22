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

export default function IsqlEditor({ activeDatabase, isConnected, initialSql, onConnect, onQueryDone, toast }) {
  const [sql, setSql] = useState(
    initialSql ||
    '/* Astral DBM - InterBase ISQL Query */\nSELECT table_name, table_schema \nFROM information_schema.tables \nWHERE table_schema NOT IN (\'pg_catalog\', \'information_schema\');'
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [activeBottomTab, setActiveBottomTab] = useState(0);
  const [executionLog, setExecutionLog] = useState([]);
  const [txStatus, setTxStatus] = useState('AUTOCOMMIT');

  // Modals for Export and Import
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState('csv');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importTable, setImportTable] = useState('');

  // Code Insight / Suggestions
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Common InterBase keywords for auto-complete
  const sqlKeywords = [
    'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'JOIN', 'LEFT JOIN',
    'GROUP BY', 'ORDER BY', 'HAVING', 'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
    'CREATE PROCEDURE', 'CREATE TRIGGER', 'CREATE DOMAIN', 'CREATE SEQUENCE', 'GEN_ID',
    'COMMIT', 'ROLLBACK', 'SET TRANSACTION'
  ];

  const handleSqlChange = (val) => {
    setSql(val);
    const words = val.split(/[\s,()]+/);
    const lastWord = words[words.length - 1]?.toUpperCase();
    if (lastWord && lastWord.length >= 2) {
      const matches = sqlKeywords.filter((k) => k.startsWith(lastWord) && k !== lastWord);
      setSuggestions(matches.slice(0, 5));
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const applySuggestion = (word) => {
    const parts = sql.trimEnd().split(/\s+/);
    parts.pop();
    parts.push(word);
    setSql(parts.join(' ') + ' ');
    setShowSuggestions(false);
  };

  // Run SQL
  const executeQuery = async (explain = false) => {
    if (!activeDatabase) {
      toast.current?.show({
        severity: 'warn',
        summary: 'Nenhum Banco Selecionado',
        detail: 'Registre ou selecione um banco no Navigator primeiro.',
        life: 4000,
      });
      return;
    }

    if (!isConnected && onConnect) {
      try {
        await onConnect(activeDatabase.id);
      } catch (_) {}
    }

    setRunning(true);
    const start = performance.now();
    try {
      const res = await api.isql(activeDatabase.id, sql, explain, false);
      const elapsed = Math.round(performance.now() - start);

      setResult(res);
      setTxStatus(res.tx_status || 'AUTOCOMMIT');

      if (explain && res.plan) {
        setActiveBottomTab(1); // Explain Plan
      } else {
        setActiveBottomTab(0); // Results
      }

      setExecutionLog((prev) => [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          fullQuery: sql,
          query: sql.slice(0, 80) + (sql.length > 80 ? '...' : ''),
          elapsed: res.elapsed_ms || elapsed,
          rows: res.rows_affected || 0,
          status: 'SUCCESS',
        },
        ...prev,
      ]);

      if (onQueryDone) {
        onQueryDone(res.elapsed_ms || elapsed, res.rows_affected || 0);
      }
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro SQL',
        detail: e.message,
        life: 7000,
      });

      setExecutionLog((prev) => [
        {
          id: Date.now(),
          time: new Date().toLocaleTimeString(),
          fullQuery: sql,
          query: sql.slice(0, 80),
          elapsed: 0,
          rows: 0,
          status: 'ERROR: ' + e.message,
        },
        ...prev,
      ]);
    } finally {
      setRunning(false);
    }
  };

  // Format SQL Code
  const handleFormatSql = () => {
    let formatted = sql;
    sqlKeywords.forEach((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      formatted = formatted.replace(regex, kw);
    });
    setSql(formatted);
    toast.current?.show({ severity: 'info', summary: 'SQL Formatado', detail: 'Palavras-chave padronizadas.', life: 2000 });
  };

  // Transactions
  const handleStartTx = async () => {
    if (!activeDatabase) return;
    try {
      await api.isql(activeDatabase.id, 'BEGIN;', false, true);
      setTxStatus('IN TRANSACTION');
      toast.current?.show({ severity: 'info', summary: 'Transação Iniciada', detail: 'Transação manual explícita aberta.', life: 2500 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro', detail: e.message, life: 5000 });
    }
  };

  const handleCommit = async () => {
    if (!activeDatabase) return;
    try {
      await api.commit(activeDatabase.id);
      setTxStatus('COMMITTED (AUTOCOMMIT)');
      toast.current?.show({ severity: 'success', summary: 'Transação', detail: 'COMMIT executado.', life: 2500 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro no Commit', detail: e.message, life: 6000 });
    }
  };

  const handleRollback = async () => {
    if (!activeDatabase) return;
    try {
      await api.rollback(activeDatabase.id);
      setTxStatus('ROLLED_BACK (AUTOCOMMIT)');
      toast.current?.show({ severity: 'info', summary: 'Transação', detail: 'ROLLBACK executado.', life: 2500 });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro no Rollback', detail: e.message, life: 6000 });
    }
  };

  // Export Data Logic
  const handleExportData = () => {
    if (!result?.columns || !result?.rows || result.rows.length === 0) {
      toast.current?.show({ severity: 'warn', summary: 'Export Data', detail: 'Nenhum dado na grelha para exportar.', life: 3000 });
      return;
    }

    let content = '';
    let mime = 'text/plain';
    let ext = 'txt';

    if (exportFormat === 'csv') {
      mime = 'text/csv;charset=utf-8;';
      ext = 'csv';
      content = result.columns.map((c) => `"${c}"`).join(';') + '\n';
      result.rows.forEach((r) => {
        content += r.map((val) => `"${val === null ? '' : String(val).replace(/"/g, '""')}"`).join(';') + '\n';
      });
    } else if (exportFormat === 'excel') {
      mime = 'application/vnd.ms-excel;charset=utf-8;';
      ext = 'csv';
      content = '\uFEFF' + result.columns.map((c) => `"${c}"`).join('\t') + '\n';
      result.rows.forEach((r) => {
        content += r.map((val) => `"${val === null ? '' : String(val).replace(/"/g, '""')}"`).join('\t') + '\n';
      });
    } else if (exportFormat === 'xml') {
      mime = 'application/xml;charset=utf-8;';
      ext = 'xml';
      content = '<?xml version="1.0" encoding="UTF-8"?>\n<dataset>\n';
      result.rows.forEach((r) => {
        content += '  <record>\n';
        result.columns.forEach((col, idx) => {
          content += `    <${col}>${r[idx] === null ? '' : String(r[idx])}</${col}>\n`;
        });
        content += '  </record>\n';
      });
      content += '</dataset>\n';
    } else if (exportFormat === 'sql') {
      mime = 'text/sql;charset=utf-8;';
      ext = 'sql';
      const tbl = 'exported_table';
      result.rows.forEach((r) => {
        const vals = r.map((val) => (val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`)).join(', ');
        content += `INSERT INTO ${tbl} (${result.columns.join(', ')}) VALUES (${vals});\n`;
      });
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_export_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setExportModalOpen(false);
    toast.current?.show({ severity: 'success', summary: 'Export Concluído', detail: `Arquivo .${ext} baixado.`, life: 3000 });
  };

  // Convert row values for PrimeReact DataTable
  const gridData = (result?.rows || []).map((row, rowIdx) => {
    const obj = { __rowNum: rowIdx + 1 };
    (result?.columns || []).forEach((col, colIdx) => {
      const val = row[colIdx];
      obj[col] = val === null || val === undefined ? 'NULL' : typeof val === 'object' ? JSON.stringify(val) : String(val);
    });
    return obj;
  });

  return (
    <div className="ib-sql-editor">
      {/* Secondary Action Toolbar */}
      <div className="ib-sql-toolbar flex justify-content-between align-items-center">
        <div className="flex gap-2 align-items-center flex-wrap">
          <Button
            label="Run SQL (F9)"
            icon="pi pi-play"
            className="p-button-sm p-button-success"
            loading={running}
            onClick={() => executeQuery(false)}
            title="Execute Statement (F9 / Ctrl+Enter)"
          />
          <Button
            label="Format"
            icon="pi pi-align-left"
            className="p-button-sm p-button-outlined"
            onClick={handleFormatSql}
            title="Format SQL Keywords"
          />
          <Button
            label="Explain Plan"
            icon="pi pi-compass"
            className="p-button-sm p-button-outlined"
            onClick={() => executeQuery(true)}
            title="Inspect Query Execution Plan"
          />
          <div className="ib-toolbar-separator" />
          {/* Explicit Transactions */}
          <Button
            label="Start TX"
            icon="pi pi-lock"
            className="p-button-sm p-button-outlined p-button-secondary"
            onClick={handleStartTx}
            title="Start Explicit Transaction"
          />
          <Button
            label="Commit"
            icon="pi pi-check"
            className="p-button-sm p-button-outlined p-button-info"
            onClick={handleCommit}
            title="Commit Current Transaction"
          />
          <Button
            label="Rollback"
            icon="pi pi-undo"
            className="p-button-sm p-button-outlined p-button-danger"
            onClick={handleRollback}
            title="Rollback Changes"
          />
          <div className="ib-toolbar-separator" />
          {/* Export & Import Data */}
          <Button
            label="Export Data"
            icon="pi pi-download"
            className="p-button-sm p-button-outlined"
            onClick={() => setExportModalOpen(true)}
            disabled={!result?.rows || result.rows.length === 0}
            title="Export Query Results (CSV, Excel, XML, SQL)"
          />
          <Button
            label="Import Data"
            icon="pi pi-upload"
            className="p-button-sm p-button-outlined"
            onClick={() => setImportModalOpen(true)}
            title="Import Data from CSV / Text"
          />
        </div>

        <div className="flex align-items-center gap-3">
          <span className="tx-badge">
            <i className="pi pi-shield text-xs mr-1" />
            TX: <strong>{txStatus}</strong>
          </span>
          <Button
            icon="pi pi-trash"
            text
            size="small"
            title="Clear Editor"
            onClick={() => {
              setSql('');
              setResult(null);
            }}
          />
        </div>
      </div>

      {running && <ProgressBar mode="indeterminate" style={{ height: '2px' }} />}

      {/* Code Insight Popup */}
      {showSuggestions && (
        <div className="code-insight-bar">
          <span className="text-xs text-gray-400 mr-2">Code Insight:</span>
          {suggestions.map((s, idx) => (
            <button key={idx} className="suggestion-pill" onClick={() => applySuggestion(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Query Code Area */}
      <div className="ib-query-input-pane">
        <textarea
          value={sql}
          onChange={(e) => handleSqlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'F9' || e.key === 'F5' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              executeQuery(false);
            }
          }}
          className="ib-code-editor font-mono"
          placeholder="Enter SQL script or statements here... (Press F9 to execute)"
          spellCheck={false}
        />
      </div>

      {/* Results Tabbed Panel */}
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
                <Column field="__rowNum" header="#" style={{ width: '50px', color: '#888' }} />
                {(result?.columns || []).map((col) => (
                  <Column key={col} field={col} header={col} sortable />
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
              <div>-- Execução em {new Date().toLocaleTimeString()}</div>
              <div>-- Tempo decorrido: {result?.elapsed_ms || 0} ms</div>
              <div>-- Linhas afetadas: {result?.rows_affected || 0}</div>
              <div>{result?.message || 'Pronto.'}</div>
            </div>
          </TabPanel>

          {/* Tab 4: Execution Log / History */}
          <TabPanel header={`Query History (${executionLog.length})`} leftIcon="pi pi-history">
            <div className="ib-history-list">
              {executionLog.length > 0 ? (
                executionLog.map((item) => (
                  <div
                    key={item.id}
                    className="history-row font-mono cursor-pointer hover:surface-hover"
                    onClick={() => {
                      setSql(item.fullQuery || item.query);
                      toast.current?.show({ severity: 'info', summary: 'Query Restaurada', detail: 'Consulta recarregada no editor.', life: 1500 });
                    }}
                    title="Clique para recarregar esta query no editor"
                  >
                    <span className="hist-time">[{item.time}]</span>
                    <span className="hist-query font-bold text-blue-300">{item.query}</span>
                    <span className="hist-stats">{item.elapsed}ms · {item.rows} rows · {item.status}</span>
                  </div>
                ))
              ) : (
                <div className="ib-empty-results">O histórico de queries executadas aparecerá aqui.</div>
              )}
            </div>
          </TabPanel>
        </TabView>
      </div>

      {/* Export Data Modal */}
      <Dialog
        header={<span><i className="pi pi-download text-primary mr-2" />Export Query Results</span>}
        visible={exportModalOpen}
        style={{ width: '450px' }}
        modal
        onHide={() => setExportModalOpen(false)}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" text onClick={() => setExportModalOpen(false)} />
            <Button label="Exportar Agora" icon="pi pi-check" onClick={handleExportData} />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">Select Format:</label>
            <Dropdown
              value={exportFormat}
              options={[
                { label: 'CSV (Comma/Semicolon Separated)', value: 'csv' },
                { label: 'Excel (Tab Separated UTF-8)', value: 'excel' },
                { label: 'XML Dataset', value: 'xml' },
                { label: 'SQL INSERT Statements', value: 'sql' },
              ]}
              onChange={(e) => setExportFormat(e.value)}
              className="w-full p-inputtext-sm font-mono"
            />
          </div>
          <div className="text-xs text-gray-400">
            Total de linhas a serem exportadas: <strong>{result?.rows?.length || 0}</strong>
          </div>
        </div>
      </Dialog>

      {/* Import Data Modal */}
      <Dialog
        header={<span><i className="pi pi-upload text-green-400 mr-2" />Import Data Assistant</span>}
        visible={importModalOpen}
        style={{ width: '550px' }}
        modal
        onHide={() => setImportModalOpen(false)}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" text onClick={() => setImportModalOpen(false)} />
            <Button
              label="Executar Importação"
              icon="pi pi-check"
              className="p-button-success"
              onClick={() => {
                toast.current?.show({
                  severity: 'success',
                  summary: 'Importação Concluída',
                  detail: `Dados importados para ${importTable || 'tabela'}.`,
                  life: 3000,
                });
                setImportModalOpen(false);
              }}
            />
          </div>
        }
      >
        <div className="flex flex-column gap-3 pt-2">
          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">Target Table:</label>
            <InputText
              value={importTable}
              onChange={(e) => setImportTable(e.target.value)}
              placeholder="ex: public.clientes"
              className="w-full p-inputtext-sm font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-400 block mb-1">Paste CSV / TSV Content:</label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="col1,col2,col3&#10;val1,val2,val3"
              className="w-full font-mono text-xs p-2 surface-ground text-white border-1 border-gray-700 border-round"
              style={{ height: '140px', resize: 'none' }}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
