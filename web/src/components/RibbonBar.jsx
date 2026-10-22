import React, { useState, useRef, useEffect } from 'react';

export default function RibbonBar({
  onNewConnection,
  onOpenConnection,
  onDisconnect,
  onDeleteDatabase,
  onOpenBackup,
  onOpenRestore,
  onOpenValidate,
  onOpenSecurity,
  onOpenProperties,
  onOpenMonitor,
  onOpenDataPump,
  onOpenExtractor,
  onOpenSweep,
  onOpenServerLog,
  onOpenJournaling,
  onOpenPreferences,
  onToggleExplorer,
  onToggleSql,
  onCloseAllTabs,
  onTileWindow,
  onOpenHelp,
  onOpenAbout,
  onNewSqlEditor,
  onFindReplace,
  onExit,
  isConnected,
  activeDatabase,
  recentDatabases = [],
  toast,
}) {
  const [openMenu, setOpenMenu] = useState(null);
  const menuBarRef = useRef(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMenuClick = (menuName) => {
    setOpenMenu(openMenu === menuName ? null : menuName);
  };

  const executeAction = (action) => {
    setOpenMenu(null);
    if (action) action();
  };

  const handleOpenConnClick = () => {
    if (!activeDatabase) {
      toast?.current?.show({ severity: 'warn', summary: 'Nenhum Banco', detail: 'Registre um banco no botão New Conn primeiro.', life: 3000 });
      return;
    }
    if (isConnected) {
      toast?.current?.show({ severity: 'info', summary: 'Conexão Ativa', detail: `O banco "${activeDatabase.nome}" já está conectado sob demanda.`, life: 2500 });
      return;
    }
    if (onOpenConnection) onOpenConnection(activeDatabase.id);
  };

  return (
    <div className="ib-ribbon-bar astral-ribbon-refresh">
      <div className="astral-desktop-title">
        <div className="astral-desktop-brand">
          <i className="pi pi-database" />
          <strong>ASTRAL DBM</strong><span>v2.1 · Workspaces</span>
        </div>
        <div className="astral-desktop-database">
          <span>Workspace</span><strong>{activeDatabase?.nome || 'Nenhum banco'}</strong>
          <i className={isConnected ? 'pi pi-circle-fill astral-online' : 'pi pi-circle-fill astral-offline'} />
        </div>
      </div>
      {/* 1. Top InterBase Menu Strip */}
      <div className="ib-menu-strip" ref={menuBarRef}>
        {/* Menu: File */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'file' ? 'active' : ''}`}
            onClick={() => handleMenuClick('file')}
          >
            File
          </span>
          {openMenu === 'file' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(onNewConnection)}>
                <i className="pi pi-plus text-green-400 mr-2" />
                <span>New Connection...</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(handleOpenConnClick)}>
                <i className="pi pi-sign-in text-blue-400 mr-2" />
                <span>Open Connection</span>
              </div>
              <div
                className={`dropdown-item ${!isConnected ? 'disabled' : ''}`}
                onClick={() => (!isConnected ? null : executeAction(onDisconnect))}
              >
                <i className="pi pi-power-off text-red-400 mr-2" />
                <span>Disconnect</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-header">Recent Databases</div>
              {recentDatabases.length > 0 ? (
                recentDatabases.map((db, idx) => (
                  <div key={idx} className="dropdown-item pl-4" onClick={() => executeAction(() => onOpenConnection(db.id))}>
                    <i className="pi pi-database text-gray-400 mr-2" />
                    <span>{db.nome}</span>
                  </div>
                ))
              ) : (
                <div className="dropdown-item pl-4 text-muted disabled">No recent databases</div>
              )}
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onExit)}>
                <i className="pi pi-sign-out text-yellow-400 mr-2" />
                <span>Exit</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: Edit */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'edit' ? 'active' : ''}`}
            onClick={() => handleMenuClick('edit')}
          >
            Edit
          </span>
          {openMenu === 'edit' && (
            <div className="ib-dropdown-menu">
              <div
                className="dropdown-item"
                onClick={() => executeAction(() => {
                  document.execCommand('copy');
                  toast?.current?.show({ severity: 'info', summary: 'Clipboard', detail: 'Texto copiado.', life: 1500 });
                })}
              >
                <i className="pi pi-copy mr-2" />
                <span>Copy</span>
                <span className="shortcut">Ctrl+C</span>
              </div>
              <div
                className="dropdown-item"
                onClick={() => executeAction(() => {
                  toast?.current?.show({ severity: 'info', summary: 'Paste', detail: 'Pressione Ctrl+V no editor para colar.', life: 2500 });
                })}
              >
                <i className="pi pi-file mr-2" />
                <span>Paste</span>
                <span className="shortcut">Ctrl+V</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onFindReplace)}>
                <i className="pi pi-search mr-2" />
                <span>Find / Replace...</span>
                <span className="shortcut">Ctrl+F</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onOpenPreferences)}>
                <i className="pi pi-cog text-gray-400 mr-2" />
                <span>Preferences...</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: View */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'view' ? 'active' : ''}`}
            onClick={() => handleMenuClick('view')}
          >
            View
          </span>
          {openMenu === 'view' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(onToggleExplorer)}>
                <i className="pi pi-compass mr-2" />
                <span>Explorer (Show/Hide)</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(onToggleSql)}>
                <i className="pi pi-file-edit mr-2" />
                <span>SQL Editor (Show/Hide)</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(onNewSqlEditor)}>
                <i className="pi pi-table mr-2" />
                <span>Data Grid View</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: Database */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'database' ? 'active' : ''}`}
            onClick={() => handleMenuClick('database')}
          >
            Database
          </span>
          {openMenu === 'database' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(onNewConnection)}>
                <i className="pi pi-plus-circle text-green-400 mr-2" />
                <span>Register Database...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onDeleteDatabase))}
              >
                <i className="pi pi-times text-red-400 mr-2" />
                <span>Unregister Database</span>
              </div>
              <div className="dropdown-separator" />
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenBackup))}
              >
                <i className="pi pi-database text-teal-400 mr-2" />
                <span>Backup (Wizard)...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenRestore))}
              >
                <i className="pi pi-cloud-upload text-cyan-400 mr-2" />
                <span>Restore (Wizard)...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenValidate))}
              >
                <i className="pi pi-check-circle text-green-400 mr-2" />
                <span>Validate Database...</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onOpenSecurity)}>
                <i className="pi pi-users text-purple-400 mr-2" />
                <span>Security Manager...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenProperties))}
              >
                <i className="pi pi-sliders-h text-primary mr-2" />
                <span>Properties...</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: Tools */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'tools' ? 'active' : ''}`}
            onClick={() => handleMenuClick('tools')}
          >
            Tools
          </span>
          {openMenu === 'tools' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(onOpenMonitor)}>
                <i className="pi pi-chart-line text-yellow-400 mr-2" />
                <span>SQL Monitor</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(onOpenMonitor)}>
                <i className="pi pi-gauge text-orange-400 mr-2" />
                <span>Performance Advisor / Monitor</span>
              </div>
              <div className="dropdown-separator" />
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenDataPump))}
              >
                <i className="pi pi-sync text-orange-300 mr-2" />
                <span>Data Pump...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenExtractor))}
              >
                <i className="pi pi-file-export text-teal-400 mr-2" />
                <span>Schema Extractor (DDL)...</span>
              </div>
              <div className="dropdown-separator" />
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenSweep))}
              >
                <i className="pi pi-filter text-purple-400 mr-2" />
                <span>Sweep / Database Sweep...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenServerLog))}
              >
                <i className="pi pi-file text-yellow-400 mr-2" />
                <span>Server Log (interbase.log)...</span>
              </div>
              <div
                className={`dropdown-item ${!activeDatabase ? 'disabled' : ''}`}
                onClick={() => (!activeDatabase ? null : executeAction(onOpenJournaling))}
              >
                <i className="pi pi-shield text-cyan-400 mr-2" />
                <span>Journaling &amp; Shadowing...</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: Window */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'window' ? 'active' : ''}`}
            onClick={() => handleMenuClick('window')}
          >
            Window
          </span>
          {openMenu === 'window' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(() => onTileWindow('cascade'))}>
                <i className="pi pi-clone mr-2" />
                <span>Cascade</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(() => onTileWindow('horizontal'))}>
                <i className="pi pi-pause mr-2" style={{ transform: 'rotate(90deg)' }} />
                <span>Tile Horizontally</span>
              </div>
              <div className="dropdown-item" onClick={() => executeAction(() => onTileWindow('vertical'))}>
                <i className="pi pi-pause mr-2" />
                <span>Tile Vertically</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onCloseAllTabs)}>
                <i className="pi pi-times-circle text-red-400 mr-2" />
                <span>Close All</span>
              </div>
            </div>
          )}
        </div>

        {/* Menu: Help */}
        <div className="ib-menu-wrapper">
          <span
            className={`ib-menu-item ${openMenu === 'help' ? 'active' : ''}`}
            onClick={() => handleMenuClick('help')}
          >
            Help
          </span>
          {openMenu === 'help' && (
            <div className="ib-dropdown-menu">
              <div className="dropdown-item" onClick={() => executeAction(onOpenHelp)}>
                <i className="pi pi-question-circle text-primary mr-2" />
                <span>InterBase Help</span>
              </div>
              <div className="dropdown-separator" />
              <div className="dropdown-item" onClick={() => executeAction(onOpenAbout)}>
                <i className="pi pi-info-circle text-blue-400 mr-2" />
                <span>About Astral DBM</span>
              </div>
            </div>
          )}
        </div>

        <div className="ib-brand-title">
          <span>Astral <strong>DBM</strong> <small>Database Studio</small></span>
        </div>
      </div>

      <div className="astral-workspace-label" aria-live="polite">
        <div className="astral-workspace-heading">
          <i className="pi pi-database" aria-hidden="true" />
          <span>ASTRAL DATABASE STUDIO</span>
          <small>RUST EDITION</small>
        </div>
        <div className="astral-workspace-context">
          <span>WORKSPACE</span>
          <strong>{activeDatabase?.nome || 'Nenhum banco selecionado'}</strong>
          <span className={isConnected ? 'astral-connection-live' : 'astral-connection-idle'}>
            {isConnected ? '● Conectado' : '○ Desconectado'}
          </span>
        </div>
      </div>
      {/* 2. Ribbon Action Toolbar (Quick Access Buttons) */}
      <div className="ib-action-strip">
        <div className="ib-ribbon-group">
          <button className="ib-ribbon-btn" onClick={onNewConnection} title="Register New Database">
            <i className="pi pi-plus-circle text-green-400" />
            <span>New Conn.</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={handleOpenConnClick}
            title={isConnected ? 'Banco de dados conectado' : 'Conectar ao banco'}
          >
            <i className={`pi pi-sign-in ${isConnected ? 'text-green-400' : 'text-blue-400'}`} />
            <span>{isConnected ? 'Connected' : 'Open Conn.'}</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={onDisconnect}
            disabled={!isConnected}
            title="Disconnect Active Database"
          >
            <i className="pi pi-times-circle text-red-400" />
            <span>Disconnect</span>
          </button>
          <span className="group-label">Connection</span>
        </div>

        <div className="ib-ribbon-separator" />

        <div className="ib-ribbon-group">
          <button
            className="ib-ribbon-btn"
            onClick={onOpenBackup}
            disabled={!activeDatabase}
            title="Database Backup Wizard"
          >
            <i className="pi pi-database text-teal-400" />
            <span>Backup</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={onOpenRestore}
            disabled={!activeDatabase}
            title="Database Restore Wizard"
          >
            <i className="pi pi-cloud-upload text-cyan-400" />
            <span>Restore</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={onOpenValidate}
            disabled={!activeDatabase}
            title="Validate Database Integrity"
          >
            <i className="pi pi-check-circle text-green-400" />
            <span>Validate</span>
          </button>
          <span className="group-label">Database</span>
        </div>

        <div className="ib-ribbon-separator" />

        <div className="ib-ribbon-group">
          <button className="ib-ribbon-btn" onClick={onOpenMonitor} title="Performance Advisor &amp; SQL Monitor">
            <i className="pi pi-chart-line text-yellow-400" />
            <span>SQL Monitor</span>
          </button>
          <button className="ib-ribbon-btn" onClick={onNewSqlEditor} title="Open Interactive SQL Console">
            <i className="pi pi-file-edit text-purple-400" />
            <span>New SQL Editor</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={onOpenExtractor}
            disabled={!activeDatabase}
            title="Schema Extractor (DDL Script)"
          >
            <i className="pi pi-file-export text-teal-400" />
            <span>Schema DDL</span>
          </button>
          <button
            className="ib-ribbon-btn"
            onClick={onOpenSweep}
            disabled={!activeDatabase}
            title="Sweep (MVCC Cleanup)"
          >
            <i className="pi pi-filter text-purple-400" />
            <span>Sweep</span>
          </button>
          <span className="group-label">Tools</span>
        </div>
      </div>
    </div>
  );
}
