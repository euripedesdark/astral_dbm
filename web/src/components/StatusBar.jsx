import React from 'react';

export default function StatusBar({ activeDatabase, isConnected, lastTime = 0, lastRows = 0 }) {
  return (
    <footer className="ib-statusbar">
      <div className="status-item">
        <i className={`status-dot ${isConnected ? 'online' : 'offline'}`} />
        <span>Connected: <strong>{activeDatabase ? activeDatabase.nome : 'None'}</strong></span>
      </div>

      <div className="status-item">
        <i className="pi pi-user mr-1 text-xs text-muted" />
        <span>User: <strong>{activeDatabase ? activeDatabase.usuario || 'SYSDBA' : 'N/A'}</strong></span>
      </div>

      <div className="status-item">
        <i className="pi pi-lock mr-1 text-xs text-muted" />
        <span>Mode: <strong>{activeDatabase?.somenteLeitura ? 'Read-Only' : 'Read/Write'}</strong></span>
      </div>

      <div className="status-item flex-auto justify-content-end">
        {isConnected && (
          <span className="text-xs text-muted font-mono">
            Time: <strong>{lastTime ? `${(lastTime / 1000).toFixed(2)}s` : '0.00s'}</strong> | Rows: <strong>{lastRows}</strong>
          </span>
        )}
      </div>
    </footer>
  );
}
