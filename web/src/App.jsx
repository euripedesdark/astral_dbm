import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Toast } from 'primereact/toast';
import { ConfirmDialog, confirmDialog } from 'primereact/confirmdialog';
import api from './api.js';

import RibbonBar from './components/RibbonBar.jsx';
import DatabaseNavigator from './components/DatabaseNavigator.jsx';
import IsqlEditor from './components/IsqlEditor.jsx';
import TableViewer from './components/TableViewer.jsx';
import PerformanceMonitor from './components/PerformanceMonitor.jsx';
import RegisterDatabaseModal from './components/RegisterDatabaseModal.jsx';
import BackupWizardModal from './components/BackupWizardModal.jsx';
import StatusBar from './components/StatusBar.jsx';

import {
  RestoreWizardModal,
  ValidateDatabaseModal,
  SecurityManagerModal,
  DatabasePropertiesModal,
  DataPumpModal,
  SchemaExtractorModal,
  SweepModal,
  ServerLogModal,
  JournalingModal,
  PreferencesModal,
  NewTableModal,
  NewObjectModal,
  SetGeneratorModal,
  AboutDbmModal,
  HelpModal,
} from './components/InterbaseModals.jsx';

export default function App() {
  const toast = useRef(null);

  // Connection & Catalog State
  const [conexoes, setConexoes] = useState([]);
  const [activeDatabase, setActiveDatabase] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [recentDatabases, setRecentDatabases] = useState([]);

  // Workbench Layout State
  const [showExplorer, setShowExplorer] = useState(true);

  // Workbench Tabs
  const [tabs, setTabs] = useState([
    { id: 'sql-1', title: 'SQL Editor', type: 'sql' },
  ]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // Modals
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [validateModalOpen, setValidateModalOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [propertiesModalOpen, setPropertiesModalOpen] = useState(false);
  const [dataPumpModalOpen, setDataPumpModalOpen] = useState(false);
  const [extractorModalOpen, setExtractorModalOpen] = useState(false);
  const [sweepModalOpen, setSweepModalOpen] = useState(false);
  const [serverLogModalOpen, setServerLogModalOpen] = useState(false);
  const [journalingModalOpen, setJournalingModalOpen] = useState(false);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
  const [newTableModalOpen, setNewTableModalOpen] = useState(false);
  const [newObjectModalOpen, setNewObjectModalOpen] = useState(false);
  const [newObjectType, setNewObjectType] = useState('procedure');
  const [setGenModalOpen, setSetGenModalOpen] = useState(false);
  const [selectedGenerator, setSelectedGenerator] = useState(null);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  // Metrics
  const [lastTime, setLastTime] = useState(0);
  const [lastRows, setLastRows] = useState(0);

  // Load Catalog Function
  const carregarCatalogo = useCallback(async (id) => {
    setLoadingCatalog(true);
    try {
      const cat = await api.catalogo(id);
      setCatalog(cat);
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Catálogo InterBase',
        detail: e.message,
        life: 6000,
      });
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  // Load registered connections
  const carregarConexoes = useCallback(async () => {
    try {
      const list = await api.conexoes();
      setConexoes(list);
      if (list.length > 0) {
        const current = list[0];
        setActiveDatabase(current);
        if (current.is_connected) {
          carregarCatalogo(current.id);
        }
      }
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Navigator',
        detail: 'Falha ao listar conexões: ' + e.message,
        life: 5000,
      });
    }
  }, [carregarCatalogo]);

  useEffect(() => {
    carregarConexoes();
  }, [carregarConexoes]);

  // Connect on-demand
  const conectarBanco = async (id) => {
    try {
      const status = await api.conectar(id);
      toast.current?.show({
        severity: 'success',
        summary: 'Conectado',
        detail: `Conexão sob demanda ativa com ${status.nome || 'Banco'}.`,
        life: 3000,
      });
      const list = await api.conexoes();
      setConexoes(list);
      const target = list.find((c) => c.id === id) || { ...activeDatabase, is_connected: true };
      setActiveDatabase(target);
      setRecentDatabases((prev) => [target, ...prev.filter((d) => d.id !== id)].slice(0, 5));
      carregarCatalogo(id);
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Falha ao Conectar',
        detail: e.message,
        life: 6000,
      });
    }
  };

  // Disconnect on-demand
  const desconectarBanco = async (id) => {
    try {
      await api.desconectar(id);
      toast.current?.show({
        severity: 'info',
        summary: 'Desconectado',
        detail: 'Sessão encerrada e socket fechado.',
        life: 2500,
      });
      setCatalog(null);
      const list = await api.conexoes();
      setConexoes(list);
      if (activeDatabase?.id === id) {
        setActiveDatabase({ ...activeDatabase, is_connected: false });
      }
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro',
        detail: e.message,
        life: 5000,
      });
    }
  };

  // Delete registered connection
  const excluirBanco = async (id) => {
    if (!id) return;
    try {
      await api.removerConexao(id);
      toast.current?.show({
        severity: 'success',
        summary: 'Removido',
        detail: 'Registro de banco excluído com sucesso.',
        life: 3000,
      });
      if (activeDatabase?.id === id) {
        setActiveDatabase(null);
        setCatalog(null);
      }
      await carregarConexoes();
    } catch (e) {
      toast.current?.show({
        severity: 'error',
        summary: 'Erro ao Remover',
        detail: e.message,
        life: 6000,
      });
    }
  };

  // Drop Table Handler
  const handleDropTable = async (table) => {
    if (!activeDatabase) return;
    try {
      await api.dropTable(activeDatabase.id, table.schema || 'public', table.name);
      toast.current?.show({
        severity: 'success',
        summary: 'Tabela Removida',
        detail: `Tabela "${table.name}" excluída com sucesso.`,
        life: 3000,
      });
      setTabs((prev) => prev.filter((t) => t.id !== `table-${table.name}`));
      carregarCatalogo(activeDatabase.id);
    } catch (e) {
      toast.current?.show({ severity: 'error', summary: 'Erro ao Excluir Tabela', detail: e.message, life: 6000 });
    }
  };

  // Open Table Tab
  const handleOpenTable = (table, mode = 'data') => {
    const tabId = `table-${table.name}`;
    const initialSubTab = mode === 'structure' ? 0 : mode === 'ddl' ? 4 : 3;
    const existingIdx = tabs.findIndex((t) => t.id === tabId);
    if (existingIdx >= 0) {
      setTabs((prev) =>
        prev.map((t, idx) => (idx === existingIdx ? { ...t, initialSubTab } : t))
      );
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: table.name,
          type: 'table',
          table,
          initialSubTab,
        },
      ]);
      setActiveTabIndex(tabs.length);
    }
  };

  // Open Procedure Tab
  const handleOpenProcedure = (proc) => {
    const tabId = `proc-${proc.name}`;
    const sqlCode = proc.definition
      ? proc.definition
      : `-- Stored Procedure: ${proc.name}\n-- Schema: ${proc.schema || 'public'}\n-- In: ${proc.params_in} | Out: ${proc.params_out}\n\nSELECT * FROM information_schema.routines WHERE routine_name = '${proc.name}';`;

    const existingIdx = tabs.findIndex((t) => t.id === tabId);
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: `SP: ${proc.name}`,
          type: 'sql',
          initialSql: sqlCode,
        },
      ]);
      setActiveTabIndex(tabs.length);
    }
  };

  // Open Trigger Tab
  const handleOpenTrigger = (trig) => {
    const tabId = `trig-${trig.name}`;
    const sqlCode = `-- Trigger: ${trig.name}\n-- Event: ${trig.event_type} ${trig.event_action}\n-- Status: ${trig.is_enabled ? 'ENABLED' : 'DISABLED'}\n\nSELECT * FROM information_schema.triggers WHERE trigger_name = '${trig.name}';`;

    const existingIdx = tabs.findIndex((t) => t.id === tabId);
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [
        ...prev,
        {
          id: tabId,
          title: `TR: ${trig.name}`,
          type: 'sql',
          initialSql: sqlCode,
        },
      ]);
      setActiveTabIndex(tabs.length);
    }
  };

  const handleNewSqlEditor = () => {
    const id = `sql-${Date.now()}`;
    setTabs((prev) => [...prev, { id, title: `SQL Editor ${prev.length + 1}`, type: 'sql' }]);
    setActiveTabIndex(tabs.length);
  };

  const handleOpenMonitor = () => {
    const existingIdx = tabs.findIndex((t) => t.id === 'perf-monitor');
    if (existingIdx >= 0) {
      setActiveTabIndex(existingIdx);
    } else {
      setTabs((prev) => [...prev, { id: 'perf-monitor', title: 'SQL Monitor', type: 'monitor' }]);
      setActiveTabIndex(tabs.length);
    }
  };

  const handleCloseTab = (index) => {
    if (tabs.length === 1) return;
    const nextTabs = tabs.filter((_, i) => i !== index);
    setTabs(nextTabs);
    setActiveTabIndex(Math.max(0, index - 1));
  };

  const handleCloseAllTabs = () => {
    setTabs([{ id: 'sql-1', title: 'SQL Editor', type: 'sql' }]);
    setActiveTabIndex(0);
    toast.current?.show({ severity: 'info', summary: 'Janelas', detail: 'Todas as abas foram fechadas.', life: 1500 });
  };

  const handleTileWindow = (mode) => {
    toast.current?.show({
      severity: 'info',
      summary: 'Layout',
      detail: `Modo de janela alternado para ${mode.toUpperCase()}.`,
      life: 2000,
    });
  };

  const isConnected = !!activeDatabase?.is_connected;

  return (
    <div className="ib-app">
      <Toast ref={toast} />
      <ConfirmDialog />

      {/* 1. Top Ribbon & Menu Bar */}
      <RibbonBar
        onNewConnection={() => setRegisterModalOpen(true)}
        onOpenConnection={() => activeDatabase && conectarBanco(activeDatabase.id)}
        onDisconnect={() => activeDatabase && desconectarBanco(activeDatabase.id)}
        onDeleteDatabase={() => {
          if (!activeDatabase) return;
          confirmDialog({
            message: `Deseja realmente remover o registro de "${activeDatabase.nome}"?`,
            header: 'Confirmar Remoção',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: 'Remover',
            rejectLabel: 'Cancelar',
            acceptClassName: 'p-button-danger',
            accept: () => excluirBanco(activeDatabase.id),
          });
        }}
        onOpenBackup={() => setBackupModalOpen(true)}
        onOpenRestore={() => setRestoreModalOpen(true)}
        onOpenValidate={() => setValidateModalOpen(true)}
        onOpenSecurity={() => setSecurityModalOpen(true)}
        onOpenProperties={() => setPropertiesModalOpen(true)}
        onOpenMonitor={handleOpenMonitor}
        onOpenDataPump={() => setDataPumpModalOpen(true)}
        onOpenExtractor={() => setExtractorModalOpen(true)}
        onOpenSweep={() => setSweepModalOpen(true)}
        onOpenServerLog={() => setServerLogModalOpen(true)}
        onOpenJournaling={() => setJournalingModalOpen(true)}
        onOpenPreferences={() => setPreferencesModalOpen(true)}
        onToggleExplorer={() => setShowExplorer((prev) => !prev)}
        onToggleSql={handleNewSqlEditor}
        onCloseAllTabs={handleCloseAllTabs}
        onTileWindow={handleTileWindow}
        onOpenHelp={() => setHelpModalOpen(true)}
        onOpenAbout={() => setAboutModalOpen(true)}
        onNewSqlEditor={handleNewSqlEditor}
        onFindReplace={() => {
          toast.current?.show({ severity: 'info', summary: 'Find / Replace', detail: 'Utilize Ctrl+F diretamente na área do editor SQL.', life: 2500 });
        }}
        onExit={() => window.location.reload()}
        isConnected={isConnected}
        activeDatabase={activeDatabase}
        recentDatabases={recentDatabases}
        toast={toast}
      />

      {/* 2. Main Workbench Body */}
      <div className="ib-workbench-body">
        {/* Left Pane: Database Navigator */}
        {showExplorer && (
          <aside className="ib-workbench-nav">
            <DatabaseNavigator
              conexoes={conexoes}
              activeDatabase={activeDatabase}
              catalog={catalog}
              loadingCatalog={loadingCatalog}
              onSelectDatabase={(conn) => {
                setActiveDatabase(conn);
                if (conn.is_connected && !catalog) {
                  carregarCatalogo(conn.id);
                }
              }}
              onConnectDatabase={conectarBanco}
              onDisconnectDatabase={desconectarBanco}
              onDeleteDatabase={excluirBanco}
              onOpenTable={handleOpenTable}
              onOpenProcedure={handleOpenProcedure}
              onOpenTrigger={handleOpenTrigger}
              onOpenNewSql={handleNewSqlEditor}
              onOpenBackup={() => setBackupModalOpen(true)}
              onOpenRestore={() => setRestoreModalOpen(true)}
              onOpenValidate={() => setValidateModalOpen(true)}
              onOpenProperties={() => setPropertiesModalOpen(true)}
              onRegisterNew={() => setRegisterModalOpen(true)}
              onOpenNewTable={() => setNewTableModalOpen(true)}
              onDropTable={handleDropTable}
              onOpenNewObject={(type) => {
                setNewObjectType(type);
                setNewObjectModalOpen(true);
              }}
              onSetGenerator={(gen) => {
                setSelectedGenerator(gen);
                setSetGenModalOpen(true);
              }}
              onOpenSecurity={() => setSecurityModalOpen(true)}
              toast={toast}
            />
          </aside>
        )}

        {/* Center Pane: Workbench Tab Area */}
        <main className="ib-workbench-main">
          <div className="ib-tab-header">
            {tabs.map((t, i) => (
              <div
                key={t.id}
                className={`ib-tab-item ${activeTabIndex === i ? 'active' : ''}`}
                onClick={() => setActiveTabIndex(i)}
              >
                <i
                  className={
                    t.type === 'sql'
                      ? 'pi pi-file-edit text-purple-400 mr-1 text-xs'
                      : t.type === 'table'
                      ? 'pi pi-table text-blue-400 mr-1 text-xs'
                      : 'pi pi-chart-line text-yellow-400 mr-1 text-xs'
                  }
                />
                <span>{t.title}</span>
                {tabs.length > 1 && (
                  <i
                    className="pi pi-times tab-close-btn ml-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(i);
                    }}
                  />
                )}
              </div>
            ))}
            <button className="ib-tab-add-btn" onClick={handleNewSqlEditor} title="New SQL Tab">
              <i className="pi pi-plus" />
            </button>
          </div>

          <div className="ib-tab-content">
            {tabs[activeTabIndex]?.type === 'sql' && (
              <IsqlEditor
                key={tabs[activeTabIndex].id}
                activeDatabase={activeDatabase}
                isConnected={isConnected}
                initialSql={tabs[activeTabIndex].initialSql}
                onConnect={conectarBanco}
                onQueryDone={(t, r) => {
                  setLastTime(t);
                  setLastRows(r);
                }}
                toast={toast}
              />
            )}

            {tabs[activeTabIndex]?.type === 'table' && (
              <TableViewer
                key={tabs[activeTabIndex].id}
                activeDatabase={activeDatabase}
                table={tabs[activeTabIndex].table}
                initialSubTab={tabs[activeTabIndex].initialSubTab || 0}
                toast={toast}
              />
            )}

            {tabs[activeTabIndex]?.type === 'monitor' && (
              <PerformanceMonitor activeDatabase={activeDatabase} isConnected={isConnected} />
            )}
          </div>
        </main>
      </div>

      {/* 3. Bottom Status Bar */}
      <StatusBar
        activeDatabase={activeDatabase}
        isConnected={isConnected}
        lastTime={lastTime}
        lastRows={lastRows}
      />

      {/* --- ALL INTERBASE MODALS & WIZARDS --- */}
      <RegisterDatabaseModal
        visible={registerModalOpen}
        onHide={() => setRegisterModalOpen(false)}
        onSaved={carregarConexoes}
        toast={toast}
      />

      <BackupWizardModal
        visible={backupModalOpen}
        onHide={() => setBackupModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <RestoreWizardModal
        visible={restoreModalOpen}
        onHide={() => setRestoreModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <ValidateDatabaseModal
        visible={validateModalOpen}
        onHide={() => setValidateModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <SecurityManagerModal
        visible={securityModalOpen}
        onHide={() => setSecurityModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <DatabasePropertiesModal
        visible={propertiesModalOpen}
        onHide={() => setPropertiesModalOpen(false)}
        activeDatabase={activeDatabase}
        catalog={catalog}
        toast={toast}
      />

      <DataPumpModal
        visible={dataPumpModalOpen}
        onHide={() => setDataPumpModalOpen(false)}
        activeDatabase={activeDatabase}
        catalog={catalog}
        toast={toast}
      />

      <SchemaExtractorModal
        visible={extractorModalOpen}
        onHide={() => setExtractorModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <SweepModal
        visible={sweepModalOpen}
        onHide={() => setSweepModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <ServerLogModal
        visible={serverLogModalOpen}
        onHide={() => setServerLogModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <JournalingModal
        visible={journalingModalOpen}
        onHide={() => setJournalingModalOpen(false)}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <PreferencesModal
        visible={preferencesModalOpen}
        onHide={() => setPreferencesModalOpen(false)}
        toast={toast}
      />

      <NewTableModal
        visible={newTableModalOpen}
        onHide={() => setNewTableModalOpen(false)}
        activeDatabase={activeDatabase}
        onTableCreated={() => activeDatabase && carregarCatalogo(activeDatabase.id)}
        toast={toast}
      />

      <NewObjectModal
        visible={newObjectModalOpen}
        onHide={() => setNewObjectModalOpen(false)}
        type={newObjectType}
        activeDatabase={activeDatabase}
        onObjectCreated={() => activeDatabase && carregarCatalogo(activeDatabase.id)}
        toast={toast}
      />

      <SetGeneratorModal
        visible={setGenModalOpen}
        onHide={() => setSetGenModalOpen(false)}
        generator={selectedGenerator}
        activeDatabase={activeDatabase}
        toast={toast}
      />

      <AboutDbmModal
        visible={aboutModalOpen}
        onHide={() => setAboutModalOpen(false)}
      />

      <HelpModal
        visible={helpModalOpen}
        onHide={() => setHelpModalOpen(false)}
      />
    </div>
  );
}
