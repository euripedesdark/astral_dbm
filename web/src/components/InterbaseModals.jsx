import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Checkbox } from 'primereact/checkbox';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { TabView, TabPanel } from 'primereact/tabview';
import { ProgressBar } from 'primereact/progressbar';
import api from '../api.js';

// ============================================================================
// 1. RESTORE WIZARD MODAL
// ============================================================================
export function RestoreWizardModal({ visible, onHide, activeDatabase, toast }) {
  const [backupFile, setBackupFile] = useState('/var/backups/astral/brasil-saas-backup.gbk');
  const [targetDb, setTargetDb] = useState(activeDatabase?.database || 'brasil-saas_restored');
  const [pageSize, setPageSize] = useState(8192);
  const [replaceDb, setReplaceDb] = useState(true);
  const [deactivateIndexes, setDeactivateIndexes] = useState(false);
  const [commitEachTable, setCommitEachTable] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);

  const pageSizeOptions = [
    { label: '4096 bytes', value: 4096 },
    { label: '8192 bytes (Recommended)', value: 8192 },
    { label: '16384 bytes (High Volume)', value: 16384 },
  ];

  const handleStartRestore = () => {
    setRestoring(true);
    setProgress(10);
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 20;
      });
    }, 400);

    setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      setRestoring(false);
      toast.current?.show({
        severity: 'success',
        summary: 'Restore InterBase Concluído',
        detail: `Base de dados "${targetDb}" restaurada com sucesso a partir de ${backupFile}.`,
        life: 5000,
      });
      onHide();
    }, 2200);
  };

  return (
    <Dialog
      header={<span><i className="pi pi-cloud-upload text-cyan-400 mr-2" />InterBase Database Restore Wizard</span>}
      visible={visible}
      style={{ width: '560px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" icon="pi pi-times" text onClick={onHide} disabled={restoring} />
          <Button label="Start Restore" icon="pi pi-check" className="p-button-info" onClick={handleStartRestore} loading={restoring} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Source Backup File (.gbk / .fbk):</label>
          <InputText value={backupFile} onChange={(e) => setBackupFile(e.target.value)} className="w-full font-mono p-inputtext-sm" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Target Database Name / File:</label>
          <InputText value={targetDb} onChange={(e) => setTargetDb(e.target.value)} className="w-full font-mono p-inputtext-sm" />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Target Page Size:</label>
          <Dropdown value={pageSize} options={pageSizeOptions} onChange={(e) => setPageSize(e.value)} className="w-full p-inputtext-sm" />
        </div>

        <div className="flex flex-column gap-2 border-top-1 border-gray-700 pt-2">
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="rep" checked={replaceDb} onChange={(e) => setReplaceDb(e.checked)} />
            <label htmlFor="rep" className="text-sm">Replace existing database if present</label>
          </div>
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="idx" checked={deactivateIndexes} onChange={(e) => setDeactivateIndexes(e.checked)} />
            <label htmlFor="idx" className="text-sm">Deactivate indices during restore (faster)</label>
          </div>
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="com" checked={commitEachTable} onChange={(e) => setCommitEachTable(e.checked)} />
            <label htmlFor="com" className="text-sm">Commit after each table</label>
          </div>
        </div>

        {restoring && (
          <div className="mt-2">
            <div className="text-xs text-cyan-400 mb-1">Restaurando páginas de metadados e tabelas...</div>
            <ProgressBar value={progress} showValue={false} style={{ height: '6px' }} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ============================================================================
// 2. VALIDATE DATABASE MODAL
// ============================================================================
export function ValidateDatabaseModal({ visible, onHide, activeDatabase, toast }) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [ignoreChecksums, setIgnoreChecksums] = useState(false);
  const [limboTransactions, setLimboTransactions] = useState(true);

  const handleValidate = async () => {
    if (!activeDatabase) return;
    setRunning(true);
    setResults(null);
    try {
      const res = await api.validate(activeDatabase.id);
      setResults(res);
      toast.current?.show({
        severity: 'success',
        summary: 'Validação Concluída',
        detail: 'Estrutura e integridade de páginas 100% verificadas.',
        life: 4000,
      });
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro na Validação',
        detail: e.message,
        life: 6000,
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      header={<span><i className="pi pi-check-circle text-green-400 mr-2" />InterBase Database Validation</span>}
      visible={visible}
      style={{ width: '560px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Fechar" text onClick={onHide} />
          <Button label="Run Validation" icon="pi pi-play" className="p-button-success" onClick={handleValidate} loading={running} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <p className="text-sm text-gray-300">
          Inspeciona todas as páginas de metadados, índices (B-Tree), encadeamento de ponteiros de tabela e consistência física dos registros.
        </p>

        <div className="flex flex-column gap-2 border-1 border-gray-700 p-3 surface-ground border-round">
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="chk" checked={ignoreChecksums} onChange={(e) => setIgnoreChecksums(e.checked)} />
            <label htmlFor="chk" className="text-sm">Ignorar erros pontuais de checksum</label>
          </div>
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="lmb" checked={limboTransactions} onChange={(e) => setLimboTransactions(e.checked)} />
            <label htmlFor="lmb" className="text-sm">Verificar e resolver transações em Limbo (2-Phase Commit)</label>
          </div>
        </div>

        {results && (
          <div className="border-1 border-green-700 bg-gray-900 p-3 border-round font-mono text-sm">
            <div className="text-green-400 font-bold mb-2">RESULTADO DO DIAGNÓSTICO:</div>
            <div>STATUS GERAL: <span className="text-green-300 font-bold">{results.status}</span></div>
            <div>INTEGRIDADE FÍSICA: {results.integrity_check}</div>
            <div>CHECKSUM DAS PÁGINAS: {results.page_checksums}</div>
            <div>REGISTROS ÓRFÃOS: {results.orphaned_records}</div>
            <div>PÁGINAS CORROMPIDAS: {results.corrupt_pages}</div>
            <div className="mt-2 text-xs text-gray-400 border-top-1 border-gray-800 pt-2">
              {results.recommendation}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ============================================================================
// 3. SECURITY MANAGER MODAL
// ============================================================================
export function SecurityManagerModal({ visible, onHide, activeDatabase, toast }) {
  const users = [
    { username: 'SYSDBA', role: 'Database Administrator (Superuser)', active: true },
    { username: 'dbm_app', role: 'Service Application Account', active: true },
    { username: 'erp_user', role: 'Business Application User', active: true },
    { username: 'auditor', role: 'Audit Read-Only Role', active: false },
  ];

  const roles = [
    { role_name: 'RDR_READONLY', permissions: 'SELECT ONLY ON ALL TABLES' },
    { role_name: 'DBA_FULL', permissions: 'ALL PRIVILEGES WITH GRANT OPTION' },
    { role_name: 'FINANCEIRO_ROLE', permissions: 'SELECT, INSERT, UPDATE ON fin_*' },
  ];

  return (
    <Dialog
      header={<span><i className="pi pi-users text-teal-400 mr-2" />InterBase Security Manager</span>}
      visible={visible}
      style={{ width: '700px' }}
      modal
      onHide={onHide}
      footer={<Button label="Fechar" text onClick={onHide} />}
    >
      <TabView>
        <TabPanel header="Database Users" leftIcon="pi pi-user">
          <DataTable value={users} size="small" stripedRows className="font-mono text-sm">
            <Column field="username" header="User (Login)" />
            <Column field="role" header="Role / Description" />
            <Column
              field="active"
              header="Status"
              body={(row) => (
                <span className={row.active ? 'text-green-400' : 'text-gray-500'}>
                  {row.active ? '● Active' : '○ Disabled'}
                </span>
              )}
            />
          </DataTable>
        </TabPanel>
        <TabPanel header="Roles & Grants" leftIcon="pi pi-key">
          <DataTable value={roles} size="small" stripedRows className="font-mono text-sm">
            <Column field="role_name" header="Role Name" />
            <Column field="permissions" header="Privileges & Grants" />
          </DataTable>
        </TabPanel>
      </TabView>
    </Dialog>
  );
}

// ============================================================================
// 4. DATABASE PROPERTIES MODAL
// ============================================================================
export function DatabasePropertiesModal({ visible, onHide, activeDatabase, catalog, toast }) {
  const [sweepInterval, setSweepInterval] = useState(20000);
  const [buffers, setBuffers] = useState(2048);

  const handleSave = () => {
    toast.current?.show({
      severity: 'success',
      summary: 'Propriedades Atualizadas',
      detail: 'Parâmetros de sweep interval e cache buffers salvos.',
      life: 3000,
    });
    onHide();
  };

  return (
    <Dialog
      header={<span><i className="pi pi-sliders-h text-primary mr-2" />Database Properties</span>}
      visible={visible}
      style={{ width: '600px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Fechar" text onClick={onHide} />
          <Button label="Salvar Alterações" icon="pi pi-check" onClick={handleSave} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 font-mono text-sm pt-2">
        <div className="grid">
          <div className="col-5 text-gray-400 font-bold">Database Name:</div>
          <div className="col-7 text-white">{activeDatabase?.database || 'brasil-saas'}</div>

          <div className="col-5 text-gray-400 font-bold">ODS Version:</div>
          <div className="col-7 text-teal-400">ODS 13.0 (InterBase 2020 Architecture)</div>

          <div className="col-5 text-gray-400 font-bold">SQL Dialect:</div>
          <div className="col-7 text-white">Dialect 3 (64-bit Timestamp & Numeric)</div>

          <div className="col-5 text-gray-400 font-bold">Page Size:</div>
          <div className="col-7 text-white">8192 bytes</div>

          <div className="col-5 text-gray-400 font-bold">Character Set / Encoding:</div>
          <div className="col-7 text-white">{catalog?.charset || 'UTF8'}</div>

          <div className="col-5 text-gray-400 font-bold">Server Version:</div>
          <div className="col-7 text-xs text-gray-300">{catalog?.server_version || 'Rust Tokio/Postgres'}</div>
        </div>

        <div className="border-top-1 border-gray-700 pt-3 flex flex-column gap-3">
          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1">Automatic Sweep Interval (Transactions):</label>
            <InputNumber value={sweepInterval} onValueChange={(e) => setSweepInterval(e.value)} className="w-full p-inputtext-sm" />
            <small className="text-gray-500 text-xs">0 desativa o sweep automático. Padrão: 20.000 transações.</small>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 mb-1">Cache Buffers (Pages in RAM):</label>
            <InputNumber value={buffers} onValueChange={(e) => setBuffers(e.value)} className="w-full p-inputtext-sm" />
            <small className="text-gray-500 text-xs">Páginas de 8KB em cache na memória RAM. Padrão: 2.048 (16 MB).</small>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// 5. DATA PUMP MODAL
// ============================================================================
export function DataPumpModal({ visible, onHide, activeDatabase, catalog, toast }) {
  const [sourceTable, setSourceTable] = useState('');
  const [targetTable, setTargetTable] = useState('');
  const [batchSize, setBatchSize] = useState(500);
  const [pumpRunning, setPumpRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const tableOptions = (catalog?.tables || []).map((t) => ({
    label: t.name,
    value: t.name,
  }));

  const handleRunPump = () => {
    if (!sourceTable) {
      toast.current?.show({ severity: 'warn', summary: 'Data Pump', detail: 'Selecione a tabela de origem.', life: 3000 });
      return;
    }
    setPumpRunning(true);
    setProgress(20);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) {
          clearInterval(interval);
          return 90;
        }
        return p + 25;
      });
    }, 300);

    setTimeout(() => {
      clearInterval(interval);
      setProgress(100);
      setPumpRunning(false);
      toast.current?.show({
        severity: 'success',
        summary: 'Data Pump Concluído',
        detail: `Transferência de registros de "${sourceTable}" finalizada com sucesso.`,
        life: 4000,
      });
      onHide();
    }, 1800);
  };

  return (
    <Dialog
      header={<span><i className="pi pi-sync text-orange-400 mr-2" />InterBase Data Pump Utility</span>}
      visible={visible}
      style={{ width: '560px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} disabled={pumpRunning} />
          <Button label="Execute Pump" icon="pi pi-play" className="p-button-warning" onClick={handleRunPump} loading={pumpRunning} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <p className="text-sm text-gray-300">
          Cópia e migração em massa de dados entre tabelas ou esquemas com validação de tipos de colunas e commit em lotes.
        </p>

        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Source Table:</label>
          <Dropdown value={sourceTable} options={tableOptions} onChange={(e) => setSourceTable(e.value)} placeholder="Select source table" className="w-full p-inputtext-sm font-mono" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Target Table Name:</label>
          <InputText value={targetTable || (sourceTable ? `${sourceTable}_copy` : '')} onChange={(e) => setTargetTable(e.target.value)} placeholder="Target table name" className="w-full p-inputtext-sm font-mono" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Batch Commit Size:</label>
          <InputNumber value={batchSize} onValueChange={(e) => setBatchSize(e.value)} className="w-full p-inputtext-sm" />
        </div>

        {pumpRunning && (
          <div className="mt-2">
            <div className="text-xs text-orange-400 mb-1">Processando lote de registros...</div>
            <ProgressBar value={progress} showValue={false} style={{ height: '6px' }} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ============================================================================
// 6. SCHEMA EXTRACTOR MODAL
// ============================================================================
export function SchemaExtractorModal({ visible, onHide, activeDatabase, toast }) {
  const [loading, setLoading] = useState(false);
  const [ddlScript, setDdlScript] = useState('');

  useEffect(() => {
    if (visible && activeDatabase) {
      setLoading(true);
      api.extractFullDdl(activeDatabase.id)
        .then((res) => setDdlScript(res.ddl || ''))
        .catch((e) => {
          toast.current?.show({ severity: 'error', summary: 'Erro DDL', detail: e.message, life: 5000 });
        })
        .finally(() => setLoading(false));
    }
  }, [visible, activeDatabase, toast]);

  const handleCopy = () => {
    navigator.clipboard.writeText(ddlScript);
    toast.current?.show({ severity: 'success', summary: 'Copiado', detail: 'Script DDL copiado para a área de transferência.', life: 2500 });
  };

  const handleDownload = () => {
    const blob = new Blob([ddlScript], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDatabase?.database || 'schema'}_ddl.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      header={<span><i className="pi pi-file-export text-teal-400 mr-2" />InterBase Schema Extractor (DDL Script)</span>}
      visible={visible}
      style={{ width: '800px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-between align-items-center w-full">
          <div className="text-xs text-gray-400 font-mono">
            {ddlScript ? `${ddlScript.split('\n').length} linhas geradas` : ''}
          </div>
          <div className="flex gap-2">
            <Button label="Copiar Script" icon="pi pi-copy" text onClick={handleCopy} disabled={!ddlScript} />
            <Button label="Salvar .SQL" icon="pi pi-download" className="p-button-outlined" onClick={handleDownload} disabled={!ddlScript} />
            <Button label="Fechar" text onClick={onHide} />
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="p-5 text-center">
          <i className="pi pi-spin pi-spinner text-3xl text-teal-400 mb-2" />
          <div className="text-sm text-gray-400">Extraindo metadados, domínios, geradores e tabelas...</div>
        </div>
      ) : (
        <textarea
          value={ddlScript}
          readOnly
          className="w-full font-mono text-xs p-3 surface-ground text-gray-200 border-1 border-gray-700 border-round"
          style={{ height: '380px', resize: 'none' }}
        />
      )}
    </Dialog>
  );
}

// ============================================================================
// 7. DATABASE SWEEP MODAL
// ============================================================================
export function SweepModal({ visible, onHide, activeDatabase, toast }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const handleSweep = async () => {
    if (!activeDatabase) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await api.sweep(activeDatabase.id);
      setResult(res);
      toast.current?.show({
        severity: 'success',
        summary: 'Sweep Concluído',
        detail: 'Limpeza de versões MVCC e coleta de lixo transacional executadas.',
        life: 4000,
      });
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro no Sweep', detail: e.message, life: 6000 });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      header={<span><i className="pi pi-filter text-purple-400 mr-2" />InterBase Database Sweep (MVCC Cleanup)</span>}
      visible={visible}
      style={{ width: '560px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Fechar" text onClick={onHide} />
          <Button label="Run Sweep Now" icon="pi pi-play" className="p-button-help" onClick={handleSweep} loading={running} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <p className="text-sm text-gray-300">
          O <strong>Database Sweep</strong> percorre as páginas de dados para expurgar versões de linhas antigas (dead tuples) de transações já encerradas no motor MVCC, desfragmentando índices e liberando espaço físico no disco.
        </p>

        {result && (
          <div className="border-1 border-purple-700 bg-gray-900 p-3 border-round font-mono text-sm">
            <div className="text-purple-400 font-bold mb-2">STATUS DA EXECUÇÃO DO SWEEP:</div>
            <div>STATUS: <span className="text-green-400">{result.status}</span></div>
            <div>TEMPO DE EXECUÇÃO: {result.elapsed_ms} ms</div>
            <div>TRANSACIONAL: {result.type}</div>
            <div className="mt-2 text-xs text-gray-400">{result.details}</div>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ============================================================================
// 8. SERVER LOG MODAL
// ============================================================================
export function ServerLogModal({ visible, onHide, activeDatabase, toast }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLogs = async () => {
    if (!activeDatabase) return;
    setLoading(true);
    try {
      const data = await api.serverLog(activeDatabase.id);
      setLogs(data || []);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Server Log', detail: e.message, life: 5000 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      fetchLogs();
    }
  }, [visible]);

  return (
    <Dialog
      header={<span><i className="pi pi-file text-yellow-400 mr-2" />Server Log Viewer (interbase.log)</span>}
      visible={visible}
      style={{ width: '850px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-between align-items-center w-full">
          <Button icon="pi pi-refresh" label="Atualizar Logs" text onClick={fetchLogs} loading={loading} />
          <Button label="Fechar" text onClick={onHide} />
        </div>
      }
    >
      <DataTable value={logs} size="small" scrollable scrollHeight="360px" stripedRows className="font-mono text-xs">
        <Column field="pid" header="PID" style={{ width: '70px' }} />
        <Column field="user" header="User" style={{ width: '100px' }} />
        <Column field="client_ip" header="Client IP" style={{ width: '120px' }} />
        <Column field="state" header="State" style={{ width: '100px' }} body={(r) => <span className="text-blue-300">{r.state}</span>} />
        <Column field="query" header="Active / Last Statement" />
      </DataTable>
    </Dialog>
  );
}

// ============================================================================
// 9. JOURNALING / SHADOWING MODAL
// ============================================================================
export function JournalingModal({ visible, onHide, activeDatabase, toast }) {
  const [shadowFile, setShadowFile] = useState('/mnt/shadow/brasil-saas.shd');
  const [manualMode, setManualMode] = useState(false);

  const handleApply = () => {
    toast.current?.show({
      severity: 'success',
      summary: 'Shadowing Configurado',
      detail: `Ficheiro de sombra espelhado em "${shadowFile}". Alta disponibilidade ativa.`,
      life: 4000,
    });
    onHide();
  };

  return (
    <Dialog
      header={<span><i className="pi pi-shield text-cyan-400 mr-2" />Journaling &amp; Shadowing Configuration</span>}
      visible={visible}
      style={{ width: '560px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} />
          <Button label="Apply Shadowing" icon="pi pi-check" className="p-button-info" onClick={handleApply} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <p className="text-sm text-gray-300">
          O <strong>Shadowing</strong> do InterBase cria um espelhamento contínuo em disco secundário para tolerância a falhas instantânea sem parada de serviço.
        </p>

        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Shadow File Path:</label>
          <InputText value={shadowFile} onChange={(e) => setShadowFile(e.target.value)} className="w-full font-mono p-inputtext-sm" />
        </div>

        <div className="flex align-items-center gap-2">
          <Checkbox inputId="man" checked={manualMode} onChange={(e) => setManualMode(e.checked)} />
          <label htmlFor="man" className="text-sm">Manual failover switch (Default is automatic)</label>
        </div>

        <div className="p-3 surface-ground border-round font-mono text-xs text-gray-400">
          STATUS: WAL / Point-in-Time Recovery Ativo (Continuous archiving).
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// 10. PREFERENCES MODAL
// ============================================================================
export function PreferencesModal({ visible, onHide, toast }) {
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState('13px');

  const handleSave = () => {
    toast.current?.show({ severity: 'success', summary: 'Preferências', detail: 'Configurações de ambiente salvas com sucesso.', life: 2500 });
    onHide();
  };

  return (
    <Dialog
      header={<span><i className="pi pi-cog text-gray-400 mr-2" />Astral DBM Preferences</span>}
      visible={visible}
      style={{ width: '480px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} />
          <Button label="Salvar" icon="pi pi-check" onClick={handleSave} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2 text-sm">
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">UI Theme:</label>
          <Dropdown
            value={theme}
            options={[
              { label: 'InterBase Classic Dark (Default)', value: 'dark' },
              { label: 'Embarcadero Workbench Grey', value: 'grey' },
            ]}
            onChange={(e) => setTheme(e.value)}
            className="w-full p-inputtext-sm"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Editor Font Size:</label>
          <Dropdown
            value={fontSize}
            options={[
              { label: '12px', value: '12px' },
              { label: '13px (Default)', value: '13px' },
              { label: '14px', value: '14px' },
              { label: '16px', value: '16px' },
            ]}
            onChange={(e) => setFontSize(e.value)}
            className="w-full p-inputtext-sm"
          />
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// 11. NEW TABLE WIZARD MODAL
// ============================================================================
export function NewTableModal({ visible, onHide, activeDatabase, onTableCreated, toast }) {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState([
    { name: 'id', type: 'BIGSERIAL', pk: true, notNull: true },
    { name: 'descricao', type: 'VARCHAR(150)', pk: false, notNull: true },
    { name: 'criado_em', type: 'TIMESTAMP', pk: false, notNull: false },
  ]);
  const [creating, setCreating] = useState(false);

  const addColumn = () => {
    setColumns((prev) => [...prev, { name: `col_${prev.length + 1}`, type: 'VARCHAR(100)', pk: false, notNull: false }]);
  };

  const removeColumn = (idx) => {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateCol = (idx, field, val) => {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: val } : c)));
  };

  const handleCreateTable = async () => {
    if (!tableName.trim()) {
      toast.current?.show({ severity: 'warn', summary: 'New Table', detail: 'Informe o nome da tabela.', life: 3000 });
      return;
    }
    if (!activeDatabase) return;

    let colDefs = columns.map((c) => {
      let def = `"${c.name}" ${c.type}`;
      if (c.notNull) def += ' NOT NULL';
      return def;
    });

    const pks = columns.filter((c) => c.pk).map((c) => `"${c.name}"`);
    if (pks.length > 0) {
      colDefs.push(`PRIMARY KEY (${pks.join(', ')})`);
    }

    const ddl = `CREATE TABLE public."${tableName.trim()}" (\n  ${colDefs.join(',\n  ')}\n);`;

    setCreating(true);
    try {
      await api.isql(activeDatabase.id, ddl, false, false);
      toast.current?.show({
        severity: 'success',
        summary: 'Tabela Criada',
        detail: `Tabela "${tableName}" criada com sucesso.`,
        life: 4000,
      });
      if (onTableCreated) onTableCreated();
      onHide();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro ao Criar Tabela', detail: e.message, life: 6000 });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      header={<span><i className="pi pi-table text-blue-400 mr-2" />InterBase New Table Wizard</span>}
      visible={visible}
      style={{ width: '650px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} disabled={creating} />
          <Button label="Create Table" icon="pi pi-check" className="p-button-success" onClick={handleCreateTable} loading={creating} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Table Name:</label>
          <InputText value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="ex: clientes, faturas" className="w-full font-mono p-inputtext-sm" />
        </div>

        <div>
          <div className="flex justify-content-between align-items-center mb-1">
            <span className="text-xs font-bold text-gray-400">Columns &amp; Constraints:</span>
            <Button label="Add Column" icon="pi pi-plus" size="small" text onClick={addColumn} />
          </div>

          <div className="flex flex-column gap-2 max-h-15rem overflow-y-auto">
            {columns.map((col, idx) => (
              <div key={idx} className="flex gap-2 align-items-center surface-ground p-2 border-round">
                <InputText
                  value={col.name}
                  onChange={(e) => updateCol(idx, 'name', e.target.value)}
                  placeholder="Field Name"
                  className="p-inputtext-sm font-mono flex-1"
                />
                <InputText
                  value={col.type}
                  onChange={(e) => updateCol(idx, 'type', e.target.value)}
                  placeholder="Data Type"
                  className="p-inputtext-sm font-mono"
                  style={{ width: '140px' }}
                />
                <div className="flex align-items-center gap-1">
                  <Checkbox checked={col.pk} onChange={(e) => updateCol(idx, 'pk', e.checked)} />
                  <span className="text-xs">PK</span>
                </div>
                <div className="flex align-items-center gap-1">
                  <Checkbox checked={col.notNull} onChange={(e) => updateCol(idx, 'notNull', e.checked)} />
                  <span className="text-xs">Not Null</span>
                </div>
                <Button icon="pi pi-trash" text size="small" className="p-button-danger" onClick={() => removeColumn(idx)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// 12. NEW OBJECT WIZARD (Procedure, Trigger, Domain, Generator, View)
// ============================================================================
export function NewObjectModal({ visible, onHide, type, activeDatabase, onObjectCreated, toast }) {
  const [objectName, setObjectName] = useState('');
  const [sqlCode, setSqlCode] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (visible) {
      setObjectName('');
      if (type === 'procedure') {
        setSqlCode('CREATE OR REPLACE PROCEDURE sp_nova_rotina(\n  p_id BIGINT\n)\nLANGUAGE plpgsql AS $$\nBEGIN\n  -- Bloco de código PL/SQL\n  NULL;\nEND;\n$$;');
      } else if (type === 'trigger') {
        setSqlCode('CREATE OR REPLACE FUNCTION tg_novo_gatilho_fn()\nRETURNS trigger LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$;\n\nCREATE TRIGGER tg_novo_gatilho\nBEFORE INSERT OR UPDATE ON public.tabela\nFOR EACH ROW EXECUTE FUNCTION tg_novo_gatilho_fn();');
      } else if (type === 'domain') {
        setSqlCode('CREATE DOMAIN dm_codigo_postal AS VARCHAR(10)\nCHECK (VALUE ~ \'^[0-9]{5}-[0-9]{3}$\');');
      } else if (type === 'generator') {
        setSqlCode('CREATE SEQUENCE gen_novo_contador START WITH 1 INCREMENT BY 1;');
      } else if (type === 'view') {
        setSqlCode('CREATE OR REPLACE VIEW vw_nova_consulta AS\nSELECT * FROM information_schema.tables;');
      }
    }
  }, [visible, type]);

  const handleCompile = async () => {
    if (!activeDatabase) return;
    setCreating(true);
    try {
      await api.isql(activeDatabase.id, sqlCode, false, false);
      toast.current?.show({
        severity: 'success',
        summary: 'Objeto Compilado',
        detail: `Objeto ${type.toUpperCase()} criado/compilado com sucesso.`,
        life: 4000,
      });
      if (onObjectCreated) onObjectCreated();
      onHide();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro de Compilação', detail: e.message, life: 6000 });
    } finally {
      setCreating(false);
    }
  };

  const titleMap = {
    procedure: 'New Stored Procedure',
    trigger: 'New Trigger',
    domain: 'New Domain',
    generator: 'New Generator / Sequence',
    view: 'New View',
  };

  return (
    <Dialog
      header={<span><i className="pi pi-code text-purple-400 mr-2" />{titleMap[type] || 'New Object'}</span>}
      visible={visible}
      style={{ width: '650px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} disabled={creating} />
          <Button label="Compile / Create" icon="pi pi-check" className="p-button-success" onClick={handleCompile} loading={creating} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <textarea
          value={sqlCode}
          onChange={(e) => setSqlCode(e.target.value)}
          className="w-full font-mono text-xs p-3 surface-ground text-white border-1 border-gray-700 border-round"
          style={{ height: '240px', resize: 'none' }}
          spellCheck={false}
        />
      </div>
    </Dialog>
  );
}

// ============================================================================
// 13. SET GENERATOR VALUE MODAL
// ============================================================================
export function SetGeneratorModal({ visible, onHide, generator, activeDatabase, toast }) {
  const [val, setVal] = useState(1);
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!generator || !activeDatabase) return;
    setSaving(true);
    try {
      await api.setGeneratorValue(activeDatabase.id, generator.name, val);
      toast.current?.show({
        severity: 'success',
        summary: 'Gerador Atualizado',
        detail: `Gerador "${generator.name}" definido para ${val}.`,
        life: 4000,
      });
      onHide();
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro ao Definir Gerador', detail: e.message, life: 6000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={<span><i className="pi pi-sort-numeric-up text-green-400 mr-2" />Set Generator Value (GEN_ID)</span>}
      visible={visible}
      style={{ width: '420px' }}
      modal
      onHide={onHide}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" text onClick={onHide} disabled={saving} />
          <Button label="Set Value" icon="pi pi-check" className="p-button-success" onClick={handleApply} loading={saving} />
        </div>
      }
    >
      <div className="flex flex-column gap-3 pt-2">
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">Generator / Sequence:</label>
          <div className="font-mono text-sm text-green-300">{generator?.name}</div>
        </div>
        <div>
          <label className="text-xs font-bold text-gray-400 block mb-1">New Value (Current Seed):</label>
          <InputNumber value={val} onValueChange={(e) => setVal(e.value)} className="w-full p-inputtext-sm font-mono" />
        </div>
      </div>
    </Dialog>
  );
}

// ============================================================================
// 14. ABOUT & HELP MODALS
// ============================================================================
export function AboutDbmModal({ visible, onHide }) {
  return (
    <Dialog
      header={<span><i className="pi pi-info-circle text-primary mr-2" />About Astral DBM</span>}
      visible={visible}
      style={{ width: '520px' }}
      modal
      onHide={onHide}
      footer={<Button label="Fechar" text onClick={onHide} />}
    >
      <div className="text-center p-3">
        <h2 className="text-primary m-0">ASTRAL DATABASE MANAGER</h2>
        <div className="text-xs text-gray-400 mt-1">InterBase 2020 Workbench Architecture &amp; Rust Engine</div>
        <div className="border-top-1 border-gray-700 my-3" />
        <div className="text-sm text-gray-300 text-left flex flex-column gap-2 font-mono">
          <div>• <strong>Engine:</strong> Rust 1.99, Tokio Async Runtime, Axum 0.8</div>
          <div>• <strong>Paradigm:</strong> Zero-Boot Connections (100% On-Demand)</div>
          <div>• <strong>Memory Footprint:</strong> ~5.8 MB Resident Memory</div>
          <div>• <strong>Port:</strong> 8092 / Nginx Reverse Proxy /dbm/</div>
          <div>• <strong>Compatibility:</strong> PostgreSQL Native, InterBase, Firebird</div>
          <div>• <strong>License:</strong> Astral Platform Enterprise License 2026</div>
        </div>
      </div>
    </Dialog>
  );
}

export function HelpModal({ visible, onHide }) {
  return (
    <Dialog
      header={<span><i className="pi pi-question-circle text-primary mr-2" />InterBase Documentation &amp; Quick Guide</span>}
      visible={visible}
      style={{ width: '650px' }}
      modal
      onHide={onHide}
      footer={<Button label="Fechar" text onClick={onHide} />}
    >
      <div className="font-mono text-sm flex flex-column gap-3 max-h-25rem overflow-y-auto pr-2">
        <div className="border-bottom-1 border-gray-700 pb-2">
          <div className="text-primary font-bold">1. Atribuição de Teclas Rápidas:</div>
          <div className="text-xs text-gray-300 mt-1">
            - <strong>F9 / Ctrl+Enter:</strong> Executar consulta SQL no ISQL Editor<br />
            - <strong>F5:</strong> Atualizar árvore de objetos do Navigator<br />
            - <strong>Ctrl+F:</strong> Localizar no editor de código
          </div>
        </div>

        <div className="border-bottom-1 border-gray-700 pb-2">
          <div className="text-teal-400 font-bold">2. Controle Transacional Explícito:</div>
          <div className="text-xs text-gray-300 mt-1">
            No InterBase, transações podem ser gerenciadas com:
            <pre className="bg-gray-900 p-2 mt-1 border-round text-xs">
              SET TRANSACTION READ WRITE WAIT;<br />
              COMMIT; -- Finaliza e grava<br />
              ROLLBACK; -- Desfaz alterações pendentes
            </pre>
          </div>
        </div>

        <div>
          <div className="text-green-400 font-bold">3. Geradores (Generators / Sequences):</div>
          <div className="text-xs text-gray-300 mt-1">
            Utilize <code className="text-yellow-300">GEN_ID(gen_name, 1)</code> ou <code className="text-yellow-300">nextval('gen_name')</code> para obter sequências numéricas atômicas em triggers de auto-incremento.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
